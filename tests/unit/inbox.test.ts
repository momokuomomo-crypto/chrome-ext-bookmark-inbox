import { describe, expect, it } from "vitest";
import {
  formatBadgeCount,
  hostnameOf,
  isHttpUrl,
  normalizeUrl,
  truncate,
} from "../../src/shared/inbox";

describe("isHttpUrl", () => {
  it("http/httpsを許可する", () => {
    expect(isHttpUrl("https://example.com/")).toBe(true);
    expect(isHttpUrl("http://example.com/")).toBe(true);
  });

  it("chrome://等・不正な文字列を拒否する", () => {
    expect(isHttpUrl("chrome://extensions")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it("URLの正規化された文字列表現を返す", () => {
    expect(normalizeUrl("https://example.com/path?x=1")).toBe(
      "https://example.com/path?x=1",
    );
  });
});

describe("truncate", () => {
  it("上限以下ならそのまま返す", () => {
    expect(truncate("短い", 10)).toBe("短い");
  });

  it("上限を超える場合は切り詰める", () => {
    expect(truncate("a".repeat(20), 10)).toHaveLength(10);
  });
});

describe("hostnameOf", () => {
  it("URLからホスト名を取り出す", () => {
    expect(hostnameOf("https://example.com/article")).toBe("example.com");
  });

  it("不正なURLはそのまま返す", () => {
    expect(hostnameOf("not-a-url")).toBe("not-a-url");
  });
});

describe("formatBadgeCount", () => {
  it("0以下は空文字", () => {
    expect(formatBadgeCount(0)).toBe("");
    expect(formatBadgeCount(-1)).toBe("");
  });

  it("99以下はそのまま文字列化", () => {
    expect(formatBadgeCount(5)).toBe("5");
    expect(formatBadgeCount(99)).toBe("99");
  });

  it("100以上は99+", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(500)).toBe("99+");
  });
});
