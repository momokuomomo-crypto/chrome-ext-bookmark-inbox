import type { EntryStatus, EntrySource, InboxEntry, InboxState } from "./types";
import {
  isHttpUrl,
  MAX_ENTRIES,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  normalizeUrl,
  SOFT_LIMIT_BYTES,
  truncate,
} from "./inbox";

const STORAGE_KEY = "inboxState";

function defaultState(): InboxState {
  return { schemaVersion: 1, entries: [] };
}

const VALID_SOURCES: EntrySource[] = ["toolbar", "context-page", "context-link"];

function isValidEntry(value: unknown): value is InboxEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<InboxEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.url === "string" &&
    typeof entry.title === "string" &&
    typeof entry.source === "string" &&
    VALID_SOURCES.includes(entry.source as EntrySource) &&
    (entry.status === "pending" || entry.status === "processed") &&
    typeof entry.createdAt === "string" &&
    typeof entry.lastSavedAt === "string" &&
    (entry.processedAt === null || typeof entry.processedAt === "string")
  );
}

// 認識できないschemaVersionのデータが既に存在する場合、単純に空状態へ
// フォールバックして以後の書き込みを許すと、次の保存・状態変更・削除で
// 元データを黙って上書きしてしまう（Stage5実装レビューでのmajor指摘：
// 「破壊的に解釈しない」というコメントと実際の動作が一致していなかった）。
// 読み取り専用の初回（データが全く無い）と、認識できない形式のデータが
// 既にある場合とを区別し、後者は例外を投げて書き込み系操作を失敗させる
// （サイレントな上書きより、失敗して気づける方が安全）。
export class UnsupportedSchemaError extends Error {}

export async function loadState(): Promise<InboxState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as InboxState | undefined;
  if (stored === undefined) return defaultState();
  if (stored.schemaVersion !== 1 || !Array.isArray(stored.entries)) {
    throw new UnsupportedSchemaError("Unrecognized inboxState schema; refusing to overwrite it.");
  }
  return { schemaVersion: 1, entries: stored.entries.filter(isValidEntry) };
}

async function saveState(state: InboxState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function listEntries(): Promise<InboxEntry[]> {
  const state = await loadState();
  return state.entries;
}

export async function countPending(): Promise<number> {
  const state = await loadState();
  return state.entries.filter((entry) => entry.status === "pending").length;
}

export async function getBytesInUse(): Promise<number> {
  return chrome.storage.local.getBytesInUse(null);
}

// 実際に書き込む予定の状態をシリアライズして予測サイズを見積もる。
// 書き込み前の使用量（getBytesInUse）だけを見る方式だと、新規追加後の
// サイズが上限を超えていても検出できない（Stage5実装レビューでのmajor
// 指摘に対応）。
function estimateStateBytes(state: InboxState): number {
  return new TextEncoder().encode(JSON.stringify({ [STORAGE_KEY]: state })).length;
}

// 直列化キュー：popup（フォアグラウンド）からの変更依頼、contextMenus経由の
// 保存、badge更新をすべてこのキューへ通す。read-modify-write競合を防ぐ
// （姉妹プロジェクトで確立済みのパターン）。
// キューはモジュールスコープのインメモリ状態であり、Service Worker再起動で
// 消滅する前提とする（今稼働中のイベントループ内の競合防止にのみ使う。
// 永続化された状態自体はchrome.storageのみを正とする）。
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
  return enqueueWrite(task);
}

export type SaveResult =
  | { ok: true; entry: InboxEntry }
  | { ok: false; code: "UNSUPPORTED_URL" | "CAPACITY_REACHED"; message: string };

// 同一URL（正規化後）が既に存在する場合：新規行を追加せず既存エントリを
// 更新する（title・source・lastSavedAtを最新の保存内容へ更新し、常に
// pendingへ戻してprocessedAtを解除する）。存在しない場合のみ新規追加する。
export function saveUrl(params: {
  url: string;
  title: string;
  source: EntrySource;
  now: string;
}): Promise<SaveResult> {
  return enqueueWrite(async () => {
    if (!isHttpUrl(params.url)) {
      return {
        ok: false,
        code: "UNSUPPORTED_URL",
        message: "このページ（http/https以外）は保存できません。",
      };
    }

    const normalizedUrl = normalizeUrl(params.url);
    // 長すぎるURLを切り詰めると、パーセントエンコードやサロゲートペアの
    // 途中で切断された別物のURLになり得るほか、先頭が同じ異なるURLを
    // 同一と誤判定する（Stage5実装レビューでのmajor指摘）。切り詰めず
    // 拒否する。
    if (normalizedUrl.length > MAX_URL_LENGTH) {
      return {
        ok: false,
        code: "UNSUPPORTED_URL",
        message: "URLが長すぎるため保存できません。",
      };
    }
    const url = normalizedUrl;
    const incomingTitle = truncate(params.title, MAX_TITLE_LENGTH);

    const state = await loadState();
    const existingIndex = state.entries.findIndex((entry) => entry.url === url);

    if (existingIndex !== -1) {
      const existing = state.entries[existingIndex]!;
      // リンク右クリック保存はアンカーテキストを取得できずホスト名を
      // titleに使うため、既に良質なタイトルを持つ既存エントリの上に
      // 単純上書きすると情報が退化する（Stage5実装レビューでのminor
      // 指摘）。context-link経由の更新では、既存タイトルがあれば維持する。
      const shouldKeepExistingTitle = params.source === "context-link" && existing.title.length > 0;
      const nextEntries = [...state.entries];
      const updated: InboxEntry = {
        ...existing,
        title: shouldKeepExistingTitle ? existing.title : incomingTitle,
        source: params.source,
        status: "pending",
        lastSavedAt: params.now,
        processedAt: null,
      };
      nextEntries[existingIndex] = updated;
      const nextState: InboxState = { schemaVersion: 1, entries: nextEntries };

      if (estimateStateBytes(nextState) >= SOFT_LIMIT_BYTES) {
        return {
          ok: false,
          code: "CAPACITY_REACHED",
          message: "保存件数・容量の上限です。処理済み項目を削除してからお試しください。",
        };
      }
      await saveState(nextState);
      return { ok: true, entry: updated };
    }

    if (state.entries.length >= MAX_ENTRIES) {
      return {
        ok: false,
        code: "CAPACITY_REACHED",
        message: "保存件数・容量の上限です。処理済み項目を削除してからお試しください。",
      };
    }

    const entry: InboxEntry = {
      id: crypto.randomUUID(),
      url,
      title: incomingTitle,
      source: params.source,
      status: "pending",
      createdAt: params.now,
      lastSavedAt: params.now,
      processedAt: null,
    };
    const nextState: InboxState = { schemaVersion: 1, entries: [...state.entries, entry] };

    // 書き込み前チェック（getBytesInUse）だけでなく、実際に書き込む予定の
    // 状態そのもののサイズを見積もり、書き込み後に上限を超えないことを
    // 確認する（Stage5実装レビューでのmajor指摘に対応）。
    if (estimateStateBytes(nextState) >= SOFT_LIMIT_BYTES) {
      return {
        ok: false,
        code: "CAPACITY_REACHED",
        message: "保存件数・容量の上限です。処理済み項目を削除してからお試しください。",
      };
    }
    await saveState(nextState);
    return { ok: true, entry };
  });
}

export function setStatus(
  id: string,
  status: EntryStatus,
  now: string,
): Promise<{ ok: boolean }> {
  return enqueueWrite(async () => {
    const state = await loadState();
    const index = state.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return { ok: false };
    const existing = state.entries[index]!;
    const nextEntries = [...state.entries];
    nextEntries[index] = {
      ...existing,
      status,
      processedAt: status === "processed" ? now : null,
    };
    await saveState({ schemaVersion: 1, entries: nextEntries });
    return { ok: true };
  });
}

export function deleteEntry(id: string): Promise<{ ok: boolean }> {
  return enqueueWrite(async () => {
    const state = await loadState();
    const nextEntries = state.entries.filter((entry) => entry.id !== id);
    if (nextEntries.length === state.entries.length) return { ok: false };
    await saveState({ schemaVersion: 1, entries: nextEntries });
    return { ok: true };
  });
}
