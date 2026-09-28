import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, formatDateJa, isValidDate, jstNow, monthRange } from "../src/shared/dates";
import { attentionOf, type AttentionInput, progressOf, type ProgressInput } from "../src/shared/progress";

describe("要対応（要件定義書 H-02）", () => {
  const base: AttentionInput = {
    status: "confirmed",
    reg_status: "approved",
    stay_status: "in_house",
    invite_sent_at: "x",
    code_sent_at: "x",
    guest_pending: 0,
    check_out_date: "2026-10-05",
    guest_checked_in: 2,
    photos_verified_at: null,
  };

  it("チェックインした人がいて照合していなければ照合待ち", () => {
    expect(attentionOf(base, "2026-10-04", "12:00", "10:00")).toEqual(["verify"]);
    expect(attentionOf({ ...base, photos_verified_at: "x" }, "2026-10-04", "12:00", "10:00")).toEqual([]);
  });

  it("チェックアウト日のチェックアウト時刻を過ぎても滞在中ならチェックアウト未操作", () => {
    const verified = { ...base, photos_verified_at: "x" };
    expect(attentionOf(verified, "2026-10-05", "09:59", "10:00")).toEqual([]);
    expect(attentionOf(verified, "2026-10-05", "10:00", "10:00")).toEqual(["overdue"]);
    expect(attentionOf(verified, "2026-10-06", "08:00", "10:00")).toEqual(["overdue"]);
    expect(attentionOf({ ...verified, stay_status: "checked_out" }, "2026-10-06", "08:00", "10:00")).toEqual([]);
  });

  it("過去の予約は進捗の要対応に数えない", () => {
    const old = { ...base, reg_status: "none" as const, stay_status: "not_arrived" as const, invite_sent_at: null, guest_checked_in: 0 };
    expect(attentionOf(old, "2026-10-06", "08:00", "10:00")).toEqual([]);
    expect(attentionOf(old, "2026-10-04", "08:00", "10:00")).toEqual(["url_unsent"]);
  });
});

describe("日付（JST）", () => {
  it("UTC の 15 時は JST の翌日 0 時になる", () => {
    expect(jstNow(new Date("2026-09-30T15:00:00Z"))).toEqual({ date: "2026-10-01", hour: 0, minute: 0 });
    expect(jstNow(new Date("2026-09-30T14:59:00Z"))).toEqual({ date: "2026-09-30", hour: 23, minute: 59 });
  });

  it("日付の計算", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-10-03", "2026-10-05")).toBe(2);
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(formatDateJa("2026-10-03")).toBe("10/3（土）");
  });

  it("存在しない日付は不正", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-2-3")).toBe(false);
    expect(isValidDate("2026-02-28")).toBe(true);
  });
});

describe("進捗（設計書 3.2）", () => {
  const base: ProgressInput = {
    status: "confirmed",
    reg_status: "none",
    stay_status: "not_arrived",
    invite_sent_at: null,
    code_sent_at: null,
    guest_pending: 0,
  };

  it.each([
    [{}, "url_unsent"],
    [{ invite_sent_at: "x" }, "url_sent"],
    [{ reg_status: "in_progress" }, "in_progress"],
    [{ reg_status: "submitted" }, "pending"],
    [{ reg_status: "rejected" }, "rejected"],
    [{ reg_status: "approved" }, "approved"],
    [{ reg_status: "approved", guest_pending: 1 }, "pending"],
    [{ reg_status: "approved", code_sent_at: "x" }, "code_sent"],
    [{ reg_status: "approved", stay_status: "in_house" }, "in_house"],
    [{ reg_status: "approved", stay_status: "checked_out" }, "checked_out"],
    [{ status: "blocked" }, "blocked"],
    [{ status: "cancelled", reg_status: "approved" }, "cancelled"],
  ] as const)("%o → %s", (over, expected) => {
    expect(progressOf({ ...base, ...over } as ProgressInput)).toBe(expected);
  });
});
