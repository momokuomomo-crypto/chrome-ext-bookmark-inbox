import { listEntries } from "../shared/storage";
import { hostnameOf, isHttpUrl } from "../shared/inbox";
import type { Request, Response } from "../shared/messages";
import type { InboxEntry } from "../shared/types";

const tabBlockedMessageEl = document.getElementById("tab-blocked-message") as HTMLElement;
const tabPreviewEl = document.getElementById("tab-preview") as HTMLElement;
const tabTitleEl = document.getElementById("tab-title") as HTMLElement;
const tabUrlEl = document.getElementById("tab-url") as HTMLElement;
const saveButton = document.getElementById("save-button") as HTMLButtonElement;
const saveMessageEl = document.getElementById("save-message") as HTMLElement;

const pendingListEl = document.getElementById("pending-list") as HTMLUListElement;
const pendingEmptyEl = document.getElementById("pending-empty") as HTMLElement;
const pendingCountEl = document.getElementById("pending-count") as HTMLElement;

const processedToggle = document.getElementById("processed-toggle") as HTMLButtonElement;
const processedListEl = document.getElementById("processed-list") as HTMLUListElement;
const processedEmptyEl = document.getElementById("processed-empty") as HTMLElement;
const processedCountEl = document.getElementById("processed-count") as HTMLElement;

let currentTab: { title: string; url: string } | undefined;

async function sendRequestSafely(request: Request): Promise<Response> {
  try {
    return (await chrome.runtime.sendMessage(request)) as Response;
  } catch {
    return { type: "MUTATION_RESULT", ok: false, error: "message-failed" };
  }
}

function showSaveMessage(text: string, kind: "success" | "error"): void {
  saveMessageEl.textContent = text;
  saveMessageEl.className = `message ${kind}`;
  saveMessageEl.hidden = false;
}

async function initCurrentTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url === undefined || !isHttpUrl(tab.url)) {
    tabPreviewEl.hidden = true;
    tabBlockedMessageEl.hidden = false;
    return;
  }
  currentTab = { title: tab.title ?? "", url: tab.url };
  tabTitleEl.textContent = currentTab.title || "(タイトルなし)";
  tabUrlEl.textContent = currentTab.url;
  tabPreviewEl.hidden = false;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function renderEntryRow(entry: InboxEntry): HTMLLIElement {
  const li = document.createElement("li");

  const titleEl = document.createElement("div");
  titleEl.className = "entry-title";
  titleEl.textContent = entry.title || hostnameOf(entry.url);
  li.appendChild(titleEl);

  const metaEl = document.createElement("div");
  metaEl.className = "entry-meta";
  metaEl.textContent = `${hostnameOf(entry.url)} ・ ${formatDate(entry.lastSavedAt)}`;
  li.appendChild(metaEl);

  const actionsEl = document.createElement("div");
  actionsEl.className = "entry-actions";

  const openButton = document.createElement("button");
  openButton.textContent = "開く";
  openButton.dataset.action = "open";
  openButton.dataset.id = entry.id;
  actionsEl.appendChild(openButton);

  const toggleButton = document.createElement("button");
  toggleButton.dataset.id = entry.id;
  if (entry.status === "pending") {
    toggleButton.textContent = "完了";
    toggleButton.dataset.action = "complete";
  } else {
    toggleButton.textContent = "未処理へ戻す";
    toggleButton.dataset.action = "reopen";
  }
  actionsEl.appendChild(toggleButton);

  const deleteButton = document.createElement("button");
  deleteButton.textContent = "削除";
  deleteButton.dataset.action = "delete";
  deleteButton.dataset.id = entry.id;
  actionsEl.appendChild(deleteButton);

  li.appendChild(actionsEl);
  return li;
}

// popup初期化・操作後・storage.onChangedからのrefresh()が並行して走ると、
// 先に開始したが遅れて完了した古い読み取りが、後から完了した新しい描画を
// 上書きしてしまう恐れがある（Stage5実装レビューでのminor指摘）。
// 世代番号を持たせ、自分より新しいrefresh()が既に完了していれば
// 描画を破棄する。
let refreshGeneration = 0;

async function refresh(): Promise<void> {
  const generation = ++refreshGeneration;
  let entries: InboxEntry[];
  try {
    entries = await listEntries();
  } catch (error) {
    // schemaVersion不整合等でlistEntries()が例外を投げた場合、無言で
    // 一覧が空表示のまま固まらないよう、ユーザーに見える形でエラーを
    // 表示する（実Chromeスモークテスト監査で発見：この関数がtry/catch
    // 無しで直接listEntries()を呼んでいた）。
    console.error("listEntries failed", error);
    showSaveMessage("一覧の取得に失敗しました。拡張機能を再読み込みしてください。", "error");
    return;
  }
  if (generation !== refreshGeneration) return;

  const pending = entries.filter((entry) => entry.status === "pending");
  const processed = entries.filter((entry) => entry.status === "processed");

  pendingCountEl.textContent = String(pending.length);
  pendingEmptyEl.hidden = pending.length > 0;
  pendingListEl.innerHTML = "";
  for (const entry of pending) pendingListEl.appendChild(renderEntryRow(entry));

  processedCountEl.textContent = String(processed.length);
  processedEmptyEl.hidden = processed.length > 0 || processedListEl.hidden;
  processedListEl.innerHTML = "";
  for (const entry of processed) processedListEl.appendChild(renderEntryRow(entry));
}

async function handleOpen(entry: InboxEntry): Promise<void> {
  void chrome.tabs.create({ url: entry.url });
}

// 応答のok:falseやメッセージ送信失敗を無視すると、利用者には操作が
// 無視されたように見える（Stage5実装レビューでのminor指摘）。
function reportIfFailed(response: Response, failureMessage: string): boolean {
  if (response.type === "MUTATION_RESULT" && !response.ok) {
    showSaveMessage(failureMessage, "error");
    return true;
  }
  return false;
}

async function handleComplete(id: string): Promise<void> {
  const response = await sendRequestSafely({ type: "SET_STATUS", id, status: "processed" });
  reportIfFailed(response, "完了にできませんでした。");
  await refresh();
}

async function handleReopen(id: string): Promise<void> {
  const response = await sendRequestSafely({ type: "SET_STATUS", id, status: "pending" });
  reportIfFailed(response, "未処理へ戻せませんでした。");
  await refresh();
}

async function handleDelete(id: string): Promise<void> {
  const confirmed = window.confirm("このページを受信箱から削除します。よろしいですか？");
  if (!confirmed) return;
  const response = await sendRequestSafely({ type: "DELETE_ENTRY", id });
  reportIfFailed(response, "削除できませんでした。");
  await refresh();
}

// 一覧が数百件になってもリスナー数が増えないよう、行ごとに個別付与せず
// コンテナへのイベント委譲で対応する（Stage2設計査読での指摘に対応）。
function registerListDelegation(listEl: HTMLUListElement): void {
  listEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest("button[data-action]") as HTMLButtonElement | null;
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (!id || !action) return;

    void (async () => {
      let entries: InboxEntry[];
      try {
        entries = await listEntries();
      } catch (error) {
        console.error("listEntries failed", error);
        return;
      }
      const entry = entries.find((candidate) => candidate.id === id);

      switch (action) {
        case "open":
          if (entry) await handleOpen(entry);
          break;
        case "complete":
          await handleComplete(id);
          break;
        case "reopen":
          await handleReopen(id);
          break;
        case "delete":
          await handleDelete(id);
          break;
        default:
          break;
      }
    })();
  });
}

registerListDelegation(pendingListEl);
registerListDelegation(processedListEl);

processedToggle.addEventListener("click", () => {
  const expanded = processedToggle.getAttribute("aria-expanded") === "true";
  processedToggle.setAttribute("aria-expanded", String(!expanded));
  processedListEl.hidden = expanded;
  void refresh();
});

saveButton.addEventListener("click", () => {
  void (async () => {
    if (!currentTab) return;
    saveButton.disabled = true;
    saveMessageEl.hidden = true;
    try {
      const response = await sendRequestSafely({
        type: "SAVE_URL",
        url: currentTab.url,
        title: currentTab.title,
        source: "toolbar",
      });
      if (response.type !== "SAVE_RESULT") {
        showSaveMessage("保存に失敗しました。", "error");
        return;
      }
      if (!response.ok) {
        showSaveMessage(response.message, "error");
        return;
      }
      showSaveMessage("保存しました。", "success");
      await refresh();
    } finally {
      saveButton.disabled = false;
    }
  })();
});

// popupは一覧の読み取りをbackgroundのキューを介さず直接storageから行うため、
// 開いている間にcontextMenus経由の保存等が起きても追従しない可能性がある。
// storage.onChangedを購読し、変更を検知したら再描画する。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && "inboxState" in changes) {
    void refresh();
  }
});

// 現在タブの取得失敗が一覧の初期描画まで巻き込まないよう、互いに独立して
// 初期化する（Stage5実装レビューでのminor指摘）。
void initCurrentTab().catch((error: unknown) => {
  console.error("initCurrentTab failed", error);
});
void refresh();
