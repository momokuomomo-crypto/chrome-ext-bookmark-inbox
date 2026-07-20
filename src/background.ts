import { countPending, deleteEntry, enqueueTask, saveUrl, setStatus } from "./shared/storage";
import { formatBadgeCount, hostnameOf } from "./shared/inbox";
import type { Request, Response } from "./shared/messages";

// badge更新もstorageの直列化キューに乗せ、複数の保存・状態変更が並行しても
// 反映順序が書き込み順序と一致するようにする。
function updateBadge(): Promise<void> {
  return enqueueTask(async () => {
    const count = await countPending();
    await chrome.action.setBadgeText({ text: formatBadgeCount(count) });
  });
}

// badge更新自体の失敗（表示の反映漏れ）が、直前に成功したデータ変更の
// 結果を「失敗」として利用者に見せてしまわないよう、独立に捕捉する
// （Stage5実装レビューでのmajor指摘：保存自体は成功しているのに
// updateBadge()が例外を投げると、外側のcatchが汎用の失敗レスポンスへ
// すり替えてしまっていた）。
async function updateBadgeSafely(): Promise<void> {
  try {
    await updateBadge();
  } catch (error) {
    console.error("updateBadge failed", error);
  }
}

// 拡張機能の更新（reason: "update"）時、removeAll()を挟まずcreate()を
// 呼ぶと、既に同一IDのメニューが登録済みで"duplicate id"エラーになり得る
// （Stage5実装レビューでのmajor指摘）。先に全削除してから登録し直す。
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-page",
      title: "このページを受信箱へ保存",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "save-link",
      title: "リンク先を受信箱へ保存",
      contexts: ["link"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    const now = new Date().toISOString();
    let result: Awaited<ReturnType<typeof saveUrl>> | undefined;
    if (info.menuItemId === "save-page") {
      const url = info.pageUrl ?? tab?.url;
      if (!url) return;
      result = await saveUrl({ url, title: tab?.title ?? "", source: "context-page", now });
    } else if (info.menuItemId === "save-link") {
      const url = info.linkUrl;
      if (!url) return;
      result = await saveUrl({ url, title: hostnameOf(url), source: "context-link", now });
    } else {
      return;
    }
    // 右クリック保存はpopupを開かず結果をユーザーに直接表示する手段が無い
    // ため、失敗時にUIへ割り込む通知は行わない（凍結設計どおり）。ただし
    // 「保存したはずが実は失敗していた」ことを後から追えるよう、
    // 失敗理由は最低限コンソールへ記録する（Stage5実装レビューでの指摘）。
    if (!result.ok) {
      console.error("context menu save failed", result.code, result.message);
    }
    await updateBadgeSafely();
  })().catch((error: unknown) => {
    console.error("context menu save failed", error);
  });
});

async function handleRequest(request: Request): Promise<Response> {
  switch (request.type) {
    case "SAVE_URL": {
      const result = await saveUrl({
        url: request.url,
        title: request.title,
        source: request.source,
        now: new Date().toISOString(),
      });
      await updateBadgeSafely();
      return result.ok
        ? { type: "SAVE_RESULT", ok: true, entry: result.entry }
        : { type: "SAVE_RESULT", ok: false, code: result.code, message: result.message };
    }
    case "SET_STATUS": {
      const result = await setStatus(request.id, request.status, new Date().toISOString());
      await updateBadgeSafely();
      return result.ok
        ? { type: "MUTATION_RESULT", ok: true }
        : { type: "MUTATION_RESULT", ok: false, error: "not-found" };
    }
    case "DELETE_ENTRY": {
      const result = await deleteEntry(request.id);
      await updateBadgeSafely();
      return result.ok
        ? { type: "MUTATION_RESULT", ok: true }
        : { type: "MUTATION_RESULT", ok: false, error: "not-found" };
    }
    default:
      return { type: "MUTATION_RESULT", ok: false, error: "unknown-request" };
  }
}

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handleRequest(request)
    .then(sendResponse)
    .catch((error: unknown) => {
      console.error("handleRequest failed", error);
      sendResponse({ type: "MUTATION_RESULT", ok: false, error: "unknown" } satisfies Response);
    });
  return true;
});

chrome.runtime.onStartup.addListener(() => {
  void updateBadgeSafely();
});

// Service Workerが起動するたびに実行する（コールドスタート／再起動の両方を
// カバーするため、onStartup/onInstalledだけでなくトップレベルでも呼ぶ）。
void updateBadgeSafely();
