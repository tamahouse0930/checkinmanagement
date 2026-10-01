import { describe, expect, it } from "vitest";
import { safeAdminPath, setupLabel } from "../src/shared/setup";

describe("ログイン後の戻り先（設計書 4.14）", () => {
  it("管理画面の中のパスは受け付ける", () => {
    expect(safeAdminPath("/admin")).toBe("/admin");
    expect(safeAdminPath("/admin/setup")).toBe("/admin/setup");
    expect(safeAdminPath("/admin/reservations/abc-123_X")).toBe("/admin/reservations/abc-123_X");
  });

  it("外部のサイトや管理画面以外へは戻さない", () => {
    for (const path of [
      null,
      undefined,
      "",
      "https://evil.example/admin",
      "//evil.example/admin",
      "/\\evil.example",
      "/admin/../kiosk",
      "/admin//evil.example",
      "/administrator",
      "/admin/setup?x=1",
      "/admin/setup#x",
      "/kiosk",
    ]) {
      expect(safeAdminPath(path)).toBeNull();
    }
  });
});

describe("初期設定の項目名", () => {
  it("項目のキーから名前を返す", () => {
    expect(setupLabel("google")).toBe("Google との連携");
  });
});
