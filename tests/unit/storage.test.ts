import { describe, expect, it } from "vitest";
import {
  countPending,
  deleteEntry,
  listEntries,
  loadState,
  saveUrl,
  setStatus,
} from "../../src/shared/storage";
import {
  MAX_ENTRIES,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  SOFT_LIMIT_BYTES,
} from "../../src/shared/inbox";

const NOW = "2026-07-21T00:00:00.000Z";
const LATER = "2026-07-21T01:00:00.000Z";

describe("saveUrl", () => {
  it("有効なURLなら新規保存できる", async () => {
    const result = await saveUrl({
      url: "https://example.com/article",
      title: "記事",
      source: "toolbar",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(await listEntries()).toHaveLength(1);
  });

  it("http/https以外は拒否する", async () => {
    const result = await saveUrl({
      url: "chrome://extensions",
      title: "t",
      source: "toolbar",
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      code: "UNSUPPORTED_URL",
      message: expect.any(String),
    });
    expect(await listEntries()).toHaveLength(0);
  });

  it("タイトルを最大長で切り詰める", async () => {
    const result = await saveUrl({
      url: "https://example.com/article",
      title: "t".repeat(MAX_TITLE_LENGTH + 50),
      source: "toolbar",
      now: NOW,
    });
    if (!result.ok) throw new Error("setup failed");
    expect(result.entry.title.length).toBe(MAX_TITLE_LENGTH);
  });

  it("URLが長すぎる場合は切り詰めず拒否する（別URLとの誤同一視を防ぐため）", async () => {
    const longPath = "a".repeat(MAX_URL_LENGTH);
    const result = await saveUrl({
      url: `https://example.com/${longPath}`,
      title: "t",
      source: "toolbar",
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      code: "UNSUPPORTED_URL",
      message: expect.any(String),
    });
    expect(await listEntries()).toHaveLength(0);
  });

  it("同一URLが未処理で存在する場合は重複を作らずlastSavedAtを更新する", async () => {
    await saveUrl({
      url: "https://example.com/article",
      title: "記事",
      source: "toolbar",
      now: NOW,
    });
    const second = await saveUrl({
      url: "https://example.com/article",
      title: "記事（更新）",
      source: "context-page",
      now: LATER,
    });
    if (!second.ok) throw new Error("setup failed");

    const entries = await listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.lastSavedAt).toBe(LATER);
    expect(entries[0]?.title).toBe("記事（更新）");
  });

  it("処理済みのURLを再保存すると未処理へ戻りprocessedAtが解除される", async () => {
    const first = await saveUrl({
      url: "https://example.com/article",
      title: "記事",
      source: "toolbar",
      now: NOW,
    });
    if (!first.ok) throw new Error("setup failed");
    await setStatus(first.entry.id, "processed", LATER);

    const second = await saveUrl({
      url: "https://example.com/article",
      title: "記事",
      source: "toolbar",
      now: "2026-07-21T02:00:00.000Z",
    });
    if (!second.ok) throw new Error("setup failed");

    expect(second.entry.status).toBe("pending");
    expect(second.entry.processedAt).toBeNull();
  });

  it("500件に達すると新規URLの保存を拒否する（既存URLの更新は許可する）", async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      await saveUrl({
        url: `https://example.com/${i}`,
        title: `t${i}`,
        source: "toolbar",
        now: NOW,
      });
    }
    const rejected = await saveUrl({
      url: "https://example.com/over-limit",
      title: "t",
      source: "toolbar",
      now: NOW,
    });
    expect(rejected).toEqual({
      ok: false,
      code: "CAPACITY_REACHED",
      message: expect.any(String),
    });

    const updated = await saveUrl({
      url: "https://example.com/0",
      title: "更新済み",
      source: "toolbar",
      now: LATER,
    });
    expect(updated.ok).toBe(true);
    expect(await listEntries()).toHaveLength(MAX_ENTRIES);
  });

  it("storage使用量が上限を超える場合は新規保存を拒否する", async () => {
    await chrome.storage.local.set({
      inboxState: {
        schemaVersion: 1,
        entries: [
          {
            id: "padding",
            url: "https://example.com/padding",
            title: "x".repeat(SOFT_LIMIT_BYTES),
            source: "toolbar",
            status: "pending",
            createdAt: NOW,
            lastSavedAt: NOW,
            processedAt: null,
          },
        ],
      },
    });
    const result = await saveUrl({
      url: "https://example.com/new",
      title: "t",
      source: "toolbar",
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      code: "CAPACITY_REACHED",
      message: expect.any(String),
    });
  });

  it("書き込み後に上限を超える新規追加は拒否する（書き込み前の使用量だけでは検出できないケース）", async () => {
    // 事前チェック（getBytesInUse）だけを見ると許可されてしまうが、
    // 実際に追加した後の状態サイズを見積もると上限を超えるケースを再現する。
    const nearLimitTitle = "x".repeat(SOFT_LIMIT_BYTES - 200);
    await chrome.storage.local.set({
      inboxState: {
        schemaVersion: 1,
        entries: [
          {
            id: "near-limit",
            url: "https://example.com/near-limit",
            title: nearLimitTitle,
            source: "toolbar",
            status: "pending",
            createdAt: NOW,
            lastSavedAt: NOW,
            processedAt: null,
          },
        ],
      },
    });

    const result = await saveUrl({
      url: "https://example.com/new-after-near-limit",
      title: "t".repeat(MAX_TITLE_LENGTH),
      source: "toolbar",
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      code: "CAPACITY_REACHED",
      message: expect.any(String),
    });
    expect(await listEntries()).toHaveLength(1);
  });

  it("リンク保存で既存の良質なタイトルをホスト名で退化させない", async () => {
    const first = await saveUrl({
      url: "https://example.com/article",
      title: "元のタイトル",
      source: "toolbar",
      now: NOW,
    });
    if (!first.ok) throw new Error("setup failed");

    const second = await saveUrl({
      url: "https://example.com/article",
      title: "example.com",
      source: "context-link",
      now: LATER,
    });
    if (!second.ok) throw new Error("setup failed");

    expect(second.entry.title).toBe("元のタイトル");
    expect(second.entry.lastSavedAt).toBe(LATER);
  });

  it("ほぼ同時の2回のsaveUrl呼び出しでも重複エントリを作らない（直列化キューの競合防止）", async () => {
    const params = {
      url: "https://example.com/concurrent",
      title: "t",
      source: "toolbar" as const,
      now: NOW,
    };

    await Promise.all([saveUrl(params), saveUrl(params)]);

    expect(await listEntries()).toHaveLength(1);
  });
});

describe("setStatus / deleteEntry", () => {
  it("処理済みにできる", async () => {
    const result = await saveUrl({
      url: "https://example.com/",
      title: "t",
      source: "toolbar",
      now: NOW,
    });
    if (!result.ok) throw new Error("setup failed");

    const setResult = await setStatus(result.entry.id, "processed", LATER);
    expect(setResult.ok).toBe(true);

    const [entry] = await listEntries();
    expect(entry?.status).toBe("processed");
    expect(entry?.processedAt).toBe(LATER);
  });

  it("未処理へ戻すとprocessedAtがnullになる", async () => {
    const result = await saveUrl({
      url: "https://example.com/",
      title: "t",
      source: "toolbar",
      now: NOW,
    });
    if (!result.ok) throw new Error("setup failed");
    await setStatus(result.entry.id, "processed", LATER);

    await setStatus(result.entry.id, "pending", "2026-07-21T02:00:00.000Z");

    const [entry] = await listEntries();
    expect(entry?.status).toBe("pending");
    expect(entry?.processedAt).toBeNull();
  });

  it("存在しないIDへの操作はok:falseを返す", async () => {
    expect((await setStatus("nonexistent", "processed", NOW)).ok).toBe(false);
    expect((await deleteEntry("nonexistent")).ok).toBe(false);
  });

  it("削除できる", async () => {
    const result = await saveUrl({
      url: "https://example.com/",
      title: "t",
      source: "toolbar",
      now: NOW,
    });
    if (!result.ok) throw new Error("setup failed");

    const del = await deleteEntry(result.entry.id);
    expect(del.ok).toBe(true);
    expect(await listEntries()).toHaveLength(0);
  });
});

describe("countPending", () => {
  it("未処理件数のみを数える", async () => {
    const a = await saveUrl({
      url: "https://example.com/a",
      title: "a",
      source: "toolbar",
      now: NOW,
    });
    const b = await saveUrl({
      url: "https://example.com/b",
      title: "b",
      source: "toolbar",
      now: NOW,
    });
    if (!a.ok || !b.ok) throw new Error("setup failed");
    await setStatus(b.entry.id, "processed", LATER);

    expect(await countPending()).toBe(1);
  });
});

describe("loadState：破損データの補正", () => {
  it("schemaVersionが不正な場合は例外を投げ、空状態への黙った上書きを許さない", async () => {
    await chrome.storage.local.set({
      inboxState: { schemaVersion: 2, entries: [{ id: "future-data" }] },
    });
    await expect(loadState()).rejects.toThrow();

    // 例外が伝播した以上、書き込み系操作も実行されず、既存データは
    // そのまま残っているはず。
    const raw = await chrome.storage.local.get("inboxState");
    expect(raw.inboxState).toEqual({ schemaVersion: 2, entries: [{ id: "future-data" }] });
  });

  it("データが全く無い初回起動時は空状態を返す（例外にしない）", async () => {
    const state = await loadState();
    expect(state).toEqual({ schemaVersion: 1, entries: [] });
  });

  it("必須フィールドを欠くエントリを破棄する", async () => {
    await chrome.storage.local.set({
      inboxState: {
        schemaVersion: 1,
        entries: [{ id: "broken", title: "missing fields" }],
      },
    });
    const state = await loadState();
    expect(state.entries).toEqual([]);
  });
});
