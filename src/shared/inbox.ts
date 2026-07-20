export const MAX_URL_LENGTH = 4096;
export const MAX_TITLE_LENGTH = 300;
export const MAX_ENTRIES = 500;
export const SOFT_LIMIT_BYTES = 4 * 1024 * 1024;

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// クエリ文字列・トラッキングパラメータ・末尾スラッシュ・フラグメントの
// 正規化は行わない。異なる画面・アプリ状態を同一ページと誤認するリスクの
// 方が、重複エントリが稀に生じるリスクより大きいと判断した設計上の選択
// （Stage2査読を踏まえた既知の制約。README等に明記する）。
export function normalizeUrl(url: string): string {
  return new URL(url).href;
}

export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// リンク右クリック保存では、アンカーテキストを取得する手段が
// chrome.contextMenus.OnClickDataに無いため、ホスト名にフォールバックする
// （Stage2査読でのmajor指摘に対応し、設計として確定）。
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function formatBadgeCount(count: number): string {
  if (count <= 0) return "";
  if (count >= 100) return "99+";
  return String(count);
}
