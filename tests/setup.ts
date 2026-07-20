import chrome from "sinon-chrome";
import sinon from "sinon";
import { afterEach, beforeEach } from "vitest";

// sinon-chromeが提供するグローバルchrome APIフェイクを、テスト実行環境へ注入する。
(globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;

// sinon-chrome(v3.0.1)はManifest V3で追加されたchrome.actionを持たない
// （browserAction/pageActionのみ）。本拡張機能はsetBadgeTextのみ使うため、
// 最小限の手書きスタブを追加する。chrome.flush()の対象外なので、
// 履歴・振る舞いのリセットはbeforeEachで個別に行う。
export interface ActionExtras {
  action: {
    setBadgeText: sinon.SinonStub;
  };
}

export const chromeExtra = chrome as unknown as ActionExtras;
chromeExtra.action = {
  setBadgeText: sinon.stub(),
};

// sinon-chromeのchrome.storage.local.get/set/getBytesInUseは呼び出し記録
// のみのsinonスタブであり、実際の永続化を模倣しない。実データを保持する
// 簡易フェイクへ差し替える（page-info-ledgerで確立したパターンと同様）。
function installFakeStorageLocal(): void {
  let store: Record<string, unknown> = {};

  chrome.storage.local.get.callsFake((keys?: string | string[] | null) => {
    if (keys === null || keys === undefined) {
      return Promise.resolve(structuredClone(store));
    }
    const keyList = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of keyList) {
      if (key in store) result[key] = store[key];
    }
    return Promise.resolve(structuredClone(result));
  });

  chrome.storage.local.set.callsFake((items: Record<string, unknown>) => {
    store = { ...store, ...structuredClone(items) };
    return Promise.resolve();
  });

  chrome.storage.local.remove.callsFake((keys: string | string[]) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) delete store[key];
    return Promise.resolve();
  });

  chrome.storage.local.getBytesInUse.callsFake(() => {
    return Promise.resolve(new TextEncoder().encode(JSON.stringify(store)).length);
  });
}

beforeEach(() => {
  chrome.flush();
  installFakeStorageLocal();
  chromeExtra.action.setBadgeText.reset();
});

afterEach(() => {
  chrome.flush();
});
