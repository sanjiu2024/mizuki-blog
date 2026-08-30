import { describe, it, expect, vi } from "vitest";
import { escapeFts5Query, searchPosts } from "../src/db/search";

describe("escapeFts5Query", () => {
  it("escapes double quotes", () => {
    const r1 = escapeFts5Query('a"b');
    expect(r1).toContain('""');
    // Actually token contains quote -> wrapped
    const r = escapeFts5Query('hello "world"');
    expect(r).toContain('""world""');
  });
  it("strips lone star and handles AND operator", () => {
    expect(escapeFts5Query("*")).toBe("");
    expect(escapeFts5Query("AND")).toBe('"AND"');
    expect(escapeFts5Query("hello AND world")).toContain('"AND"');
  });
  it("handles empty", () => {
    expect(escapeFts5Query("")).toBe("");
    expect(escapeFts5Query("   ")).toBe("");
  });
  it("keeps plain tokens", () => {
    expect(escapeFts5Query("mizuki")).toBe("mizuki");
    expect(escapeFts5Query("mizuki astro")).toBe("mizuki astro");
  });
  it("handles CJK and special chars", () => {
    const r = escapeFts5Query('深海 "笔记" *');
    expect(r.length).toBeGreaterThan(0);
    expect(r).not.toContain("*");
  });
  it("handles quoted injections", () => {
    // Should not throw FTS syntax
    const q = '":*" OR 1=1 --';
    const escaped = escapeFts5Query(q);
    expect(typeof escaped).toBe("string");
  });
});

// Mock D1 for searchPosts fallback
function mockD1(ftsThrows = true) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          if (sql.includes("posts_fts") && ftsThrows)
            throw new Error("fts5 syntax error");
          // LIKE fallback
          return {
            results: [
              {
                id: "p1",
                title: "hello",
                slug: "hello",
                excerpt: "hi",
                rank: 0,
                snippet: null,
              },
            ],
          };
        },
        first: async () => null,
      }),
    }),
  };
}

describe("searchPosts", () => {
  it("falls back to LIKE on FTS error", async () => {
    const db = mockD1(true);
    const res = await searchPosts(db as any, 'a"b', 10);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe("p1");
  });
  it("returns [] on empty q", async () => {
    const db = mockD1(false);
    const res = await searchPosts(db as any, "   ", 10);
    expect(res).toEqual([]);
  });
  it("LIKE escapes % _", async () => {
    let capturedLike = "";
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          all: async () => {
            if (sql.includes("LIKE")) capturedLike = args[0];
            if (sql.includes("posts_fts")) throw new Error("syntax");
            return { results: [] as any[] };
          },
          first: async () => null,
        }),
      }),
    };
    await searchPosts(db as any, "100%_test", 5);
    // % and _ should be escaped with backslash in LIKE pattern
    expect(capturedLike).toContain("\\%");
    expect(capturedLike).toContain("\\_");
  });
});
