import { beforeEach, describe, expect, it, vi } from "vitest";
import chrome from "sinon-chrome";
import { chromeExtra } from "../setup";
import type { Request, Response } from "../../src/shared/messages";
import { listEntries, saveUrl } from "../../src/shared/storage";

async function loadBackgroundFresh(): Promise<void> {
  vi.resetModules();
  chrome.runtime.id = "test-extension-id";
  await import("../../src/background");
}

async function dispatch(request: Request): Promise<Response> {
  const listener = chrome.runtime.onMessage.addListener.lastCall.args[0] as (
    request: Request,
    sender: unknown,
    sendResponse: (response: Response) => void,
  ) => boolean;

  return new Promise<Response>((resolve) => {
    listener(request, {}, resolve);
  });
}

interface ContextMenuInfo {
  menuItemId: string;
  pageUrl?: string;
  linkUrl?: string;
}

interface FakeTab {
  title?: string;
  url?: string;
}

function triggerContextMenuClicked(info: ContextMenuInfo, tab?: FakeTab): Promise<void> {
  const listener = chrome.contextMenus.onClicked.addListener.lastCall.args[0] as (
    info: ContextMenuInfo,
    tab?: FakeTab,
  ) => void;
  listener(info, tab);
  return flushMicrotasks();
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  chrome.tabs.create.resolves(undefined);
  chrome.contextMenus.removeAll.callsFake((callback?: () => void) => {
    callback?.();
  });
});

describe("background: リスナー登録", () => {
  it("インポート時点で同期的にリスナーを登録する", async () => {
    await loadBackgroundFresh();
    expect(chrome.runtime.onMessage.addListener.called).toBe(true);
    expect(chrome.runtime.onInstalled.addListener.called).toBe(true);
    expect(chrome.runtime.onStartup.addListener.called).toBe(true);
    expect(chrome.contextMenus.onClicked.addListener.called).toBe(true);
  });

  it("インストール時にcontextMenus項目を2つ登録する", async () => {
    await loadBackgroundFresh();
    const installListener = chrome.runtime.onInstalled.addListener.lastCall.args[0] as () => void;
    installListener();

    expect(chrome.contextMenus.removeAll.called).toBe(true);
    expect(chrome.contextMenus.create.callCount).toBe(2);
    const ids = chrome.contextMenus.create.getCalls().map((call) => call.args[0].id);
    expect(ids).toEqual(["save-page", "save-link"]);
  });

  it("拡張機能アップデート相当（onInstalledを2回発火）でも重複ID登録エラーを起こさない", async () => {
    // removeAll()を挟まずcreate()を呼ぶと、更新時に既存の同一IDメニューと
    // 衝突し得る（Stage5実装レビューでのmajor指摘）。removeAll→createの
    // 順序を2回とも守っていることを確認する。
    await loadBackgroundFresh();
    const installListener = chrome.runtime.onInstalled.addListener.lastCall.args[0] as () => void;

    installListener();
    installListener();

    expect(chrome.contextMenus.removeAll.callCount).toBe(2);
    expect(chrome.contextMenus.create.callCount).toBe(4);
  });
});

describe("background: contextMenus経由の保存", () => {
  it("save-pageはページのURL・タイトルで保存する", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();

    await triggerContextMenuClicked(
      { menuItemId: "save-page", pageUrl: "https://example.com/page" },
      { title: "ページタイトル", url: "https://example.com/page" },
    );

    const entries = await listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("ページタイトル");
    expect(entries[0]?.source).toBe("context-page");
  });

  it("save-linkはリンク先URLをホスト名タイトルで保存する", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();

    await triggerContextMenuClicked({
      menuItemId: "save-link",
      linkUrl: "https://example.com/linked-article",
    });

    const entries = await listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("example.com");
    expect(entries[0]?.source).toBe("context-link");
  });

  it("保存後にbadgeを未処理件数へ更新する", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();

    await triggerContextMenuClicked({
      menuItemId: "save-link",
      linkUrl: "https://example.com/linked-article",
    });

    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "1" });
  });

  it("無関係なmenuItemIdでは何もしない", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();

    await triggerContextMenuClicked({ menuItemId: "unrelated" });

    expect(await listEntries()).toEqual([]);
  });

  it("保存失敗（http/https以外）はUIに割り込まないがコンソールへ記録する", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadBackgroundFresh();
    await flushMicrotasks();

    await triggerContextMenuClicked({ menuItemId: "save-link", linkUrl: "mailto:test@example.com" });

    expect(await listEntries()).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("background: メッセージ経由の操作", () => {
  it("SAVE_URLで保存できる", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();

    const response = await dispatch({
      type: "SAVE_URL",
      url: "https://example.com/",
      title: "t",
      source: "toolbar",
    });

    expect(response).toEqual({
      type: "SAVE_RESULT",
      ok: true,
      entry: expect.objectContaining({ url: "https://example.com/", title: "t" }),
    });
  });

  it("SAVE_URLがhttp/https以外なら失敗理由を返す", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();

    const response = await dispatch({
      type: "SAVE_URL",
      url: "chrome://extensions",
      title: "t",
      source: "toolbar",
    });

    expect(response).toEqual({
      type: "SAVE_RESULT",
      ok: false,
      code: "UNSUPPORTED_URL",
      message: expect.any(String),
    });
  });

  it("SET_STATUSで処理済みにできる", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();
    const result = await saveUrl({
      url: "https://example.com/",
      title: "t",
      source: "toolbar",
      now: new Date().toISOString(),
    });
    if (!result.ok) throw new Error("setup failed");

    const response = await dispatch({
      type: "SET_STATUS",
      id: result.entry.id,
      status: "processed",
    });

    expect(response).toEqual({ type: "MUTATION_RESULT", ok: true });
  });

  it("DELETE_ENTRYで削除できる", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();
    const result = await saveUrl({
      url: "https://example.com/",
      title: "t",
      source: "toolbar",
      now: new Date().toISOString(),
    });
    if (!result.ok) throw new Error("setup failed");

    const response = await dispatch({ type: "DELETE_ENTRY", id: result.entry.id });

    expect(response).toEqual({ type: "MUTATION_RESULT", ok: true });
    expect(await listEntries()).toHaveLength(0);
  });

  it("存在しないIDへのSET_STATUS/DELETE_ENTRYはok:falseを返す", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();

    expect(await dispatch({ type: "SET_STATUS", id: "nonexistent", status: "processed" })).toEqual({
      type: "MUTATION_RESULT",
      ok: false,
      error: "not-found",
    });
    expect(await dispatch({ type: "DELETE_ENTRY", id: "nonexistent" })).toEqual({
      type: "MUTATION_RESULT",
      ok: false,
      error: "not-found",
    });
  });
});

describe("background: 起動時のbadge同期", () => {
  it("onStartupでbadgeを再計算する", async () => {
    await loadBackgroundFresh();
    await flushMicrotasks();
    await saveUrl({
      url: "https://example.com/",
      title: "t",
      source: "toolbar",
      now: new Date().toISOString(),
    });

    const startupListener = chrome.runtime.onStartup.addListener.lastCall.args[0] as () => void;
    startupListener();
    await flushMicrotasks();

    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "1" });
  });
});
