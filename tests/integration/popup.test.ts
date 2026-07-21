import { beforeEach, describe, expect, it, vi } from "vitest";
import chrome from "sinon-chrome";
import { saveUrl } from "../../src/shared/storage";

function mountPopupDom(): void {
  document.body.innerHTML = `
    <p id="tab-blocked-message" hidden></p>
    <div id="tab-preview" hidden>
      <p id="tab-title"></p>
      <p id="tab-url"></p>
      <button id="save-button">save</button>
    </div>
    <p id="save-message" hidden></p>
    <span id="pending-count">0</span>
    <ul id="pending-list"></ul>
    <p id="pending-empty" hidden></p>
    <button id="processed-toggle" aria-expanded="false">toggle</button>
    <span id="processed-count">0</span>
    <ul id="processed-list" hidden></ul>
    <p id="processed-empty" hidden></p>
  `;
}

async function loadPopupFresh(): Promise<void> {
  vi.resetModules();
  mountPopupDom();
  await import("../../src/popup/popup");
  await flushMicrotasks();
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  chrome.runtime.sendMessage.resolves({ type: "MUTATION_RESULT", ok: true });
  chrome.tabs.create.resolves(undefined);
});

describe("popup: activeTabのURL種別による表示切り替え", () => {
  it("http/httpsのタブなら保存プレビューを表示する", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "サンプル", url: "https://example.com/article" }]);

    await loadPopupFresh();

    expect((document.getElementById("tab-preview") as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("tab-blocked-message") as HTMLElement).hidden).toBe(true);
    expect(document.getElementById("tab-title")?.textContent).toBe("サンプル");
  });

  it("chrome://等のタブなら保存プレビューを隠しブロックメッセージを表示する", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "拡張機能", url: "chrome://extensions" }]);

    await loadPopupFresh();

    expect((document.getElementById("tab-preview") as HTMLElement).hidden).toBe(true);
    expect((document.getElementById("tab-blocked-message") as HTMLElement).hidden).toBe(false);
  });
});

describe("popup: 保存ボタン", () => {
  it("クリックするとSAVE_URLを送信し成功メッセージを表示する", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    chrome.runtime.sendMessage.resolves({
      type: "SAVE_RESULT",
      ok: true,
      entry: {
        id: "x",
        url: "https://example.com/",
        title: "t",
        source: "toolbar",
        status: "pending",
        createdAt: "2026-07-21T00:00:00.000Z",
        lastSavedAt: "2026-07-21T00:00:00.000Z",
        processedAt: null,
      },
    });

    await loadPopupFresh();
    (document.getElementById("save-button") as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage.calledWithMatch({ type: "SAVE_URL" })).toBe(true);
    const messageEl = document.getElementById("save-message") as HTMLElement;
    expect(messageEl.hidden).toBe(false);
    expect(messageEl.textContent).toBe("保存しました。");
  });

  it("容量超過時はエラーメッセージを表示する", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    chrome.runtime.sendMessage.resolves({
      type: "SAVE_RESULT",
      ok: false,
      code: "CAPACITY_REACHED",
      message: "保存件数・容量の上限です。",
    });

    await loadPopupFresh();
    (document.getElementById("save-button") as HTMLButtonElement).click();
    await flushMicrotasks();

    const messageEl = document.getElementById("save-message") as HTMLElement;
    expect(messageEl.hidden).toBe(false);
    expect(messageEl.textContent).toBe("保存件数・容量の上限です。");
  });
});

describe("popup: 一覧の操作（イベント委譲）", () => {
  it("完了ボタンでSET_STATUSを送る", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    await saveUrl({
      url: "https://example.com/target",
      title: "対象",
      source: "toolbar",
      now: "2026-07-21T00:00:00.000Z",
    });

    await loadPopupFresh();

    const completeButton = document
      .getElementById("pending-list")
      ?.querySelector('button[data-action="complete"]') as HTMLButtonElement | null;
    expect(completeButton).not.toBeNull();
    completeButton?.click();
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage.calledWithMatch({ type: "SET_STATUS", status: "processed" })).toBe(
      true,
    );
  });

  it("削除ボタンは確認をキャンセルするとDELETE_ENTRYを送らない", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    await saveUrl({
      url: "https://example.com/target",
      title: "対象",
      source: "toolbar",
      now: "2026-07-21T00:00:00.000Z",
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await loadPopupFresh();

    const deleteButton = document
      .getElementById("pending-list")
      ?.querySelector('button[data-action="delete"]') as HTMLButtonElement | null;
    deleteButton?.click();
    await flushMicrotasks();

    expect(confirmSpy).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage.calledWithMatch({ type: "DELETE_ENTRY" })).toBe(false);
    confirmSpy.mockRestore();
  });

  it("削除ボタンは確認を承認するとDELETE_ENTRYを送る", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    await saveUrl({
      url: "https://example.com/target",
      title: "対象",
      source: "toolbar",
      now: "2026-07-21T00:00:00.000Z",
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    await loadPopupFresh();

    const deleteButton = document
      .getElementById("pending-list")
      ?.querySelector('button[data-action="delete"]') as HTMLButtonElement | null;
    deleteButton?.click();
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage.calledWithMatch({ type: "DELETE_ENTRY" })).toBe(true);
    confirmSpy.mockRestore();
  });
});

describe("popup: 未知のschemaVersion（監査で発見：listEntries()のtry/catch欠如）", () => {
  it("listEntries()が例外を投げても無言で固まらず、エラーメッセージを表示する", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    await chrome.storage.local.set({ inboxState: { schemaVersion: 2, entries: [] } });

    await loadPopupFresh();

    const saveMessageEl = document.getElementById("save-message") as HTMLElement;
    expect(saveMessageEl.hidden).toBe(false);
    expect(saveMessageEl.textContent).toContain("失敗");
  });
});

describe("popup: storage.onChangedによる自動再描画", () => {
  it("inboxState以外のキー変更では再描画しない", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    await loadPopupFresh();

    const listener = chrome.storage.onChanged.addListener.lastCall.args[0] as (
      changes: Record<string, unknown>,
      areaName: string,
    ) => void;
    const before = document.getElementById("pending-list")?.innerHTML;
    listener({ unrelatedKey: {} }, "local");
    await flushMicrotasks();

    expect(document.getElementById("pending-list")?.innerHTML).toBe(before);
  });

  it("inboxStateキーの変更でrefreshが走り一覧が更新される", async () => {
    chrome.tabs.query.resolves([{ id: 1, title: "t", url: "https://example.com/" }]);
    await loadPopupFresh();

    await saveUrl({
      url: "https://example.com/late",
      title: "後から追加",
      source: "toolbar",
      now: "2026-07-21T00:00:00.000Z",
    });

    const listener = chrome.storage.onChanged.addListener.lastCall.args[0] as (
      changes: Record<string, unknown>,
      areaName: string,
    ) => void;
    listener({ inboxState: {} }, "local");
    await flushMicrotasks();

    expect(document.getElementById("pending-list")?.textContent).toContain("後から追加");
  });
});
