import { describe, expect, it } from "vitest";
import { planReconcile } from "../src/worker/services/retention";

const photo = (id: string, missing = false) => ({ id, drive_file_id: `d-${id}`, missing_at: missing ? "2026-10-01T00:00:00Z" : null });

describe("写真の突き合わせの判定（設計書 4.13）", () => {
  it("ドライブの一覧にない写真は見つからない写真になり、印のない写真だけを新しく更新する", () => {
    const r = planReconcile([photo("a"), photo("b"), photo("c", true)], new Set(["d-a"]), true);
    expect(r.nowMissing).toEqual(["b"]);
    expect(r.nowFound).toEqual([]);
    expect(r.missing).toBe(2);
  });

  it("見つかるようになった写真は印を外す", () => {
    const r = planReconcile([photo("a", true), photo("b")], new Set(["d-a", "d-b"]), true);
    expect(r.nowFound).toEqual(["a"]);
    expect(r.nowMissing).toEqual([]);
    expect(r.missing).toBe(0);
  });

  it("ドライブの一覧が途中までのときは、新しく見つからないとはしない", () => {
    const r = planReconcile([photo("a"), photo("b", true), photo("c")], new Set(["d-c"]), false);
    expect(r.nowMissing).toEqual([]);
    expect(r.missing).toBe(1);
  });
});
