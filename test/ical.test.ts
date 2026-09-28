import { describe, expect, it } from "vitest";
import { eventFields, type ExistingReservation, parseIcal, planSync } from "../src/worker/services/ical";

// 実際の Airbnb の iCal の形式（値は架空）
const AIRBNB = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261005",
  "DTSTART;VALUE=DATE:20261003",
  "UID:1418fb94e984-aaa@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCD1234\\nPhone Numbe",
  " r (Last 4 Digits): 5678",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261020",
  "DTSTART;VALUE=DATE:20261015",
  "UID:7f8e9d-bbb@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// 実際の Booking.com の iCal の形式（値は架空）
const BOOKING = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "DTSTAMP:20260928T000000Z",
  "DTSTART;VALUE=DATE:20261010",
  "DTEND;VALUE=DATE:20261012",
  "UID:abc123@booking.com",
  "SUMMARY:CLOSED - Not available",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\n");

describe("parseIcal", () => {
  it("Airbnb の予約とブロックを読み、折り返された行をつなげる", () => {
    const events = parseIcal(AIRBNB);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ uid: "1418fb94e984-aaa@airbnb.com", start: "2026-10-03", end: "2026-10-05", summary: "Reserved" });
    expect(events[0].description).toContain("Phone Number (Last 4 Digits): 5678");
  });

  it("Booking.com の予約を読む", () => {
    expect(parseIcal(BOOKING)).toEqual([
      { uid: "abc123@booking.com", start: "2026-10-10", end: "2026-10-12", summary: "CLOSED - Not available", description: "" },
    ]);
  });
});

describe("eventFields", () => {
  it("Airbnb の予約から予約コードと電話番号の下 4 桁を取り出し、Not available はブロックにする", () => {
    const [reserved, blocked] = parseIcal(AIRBNB);
    expect(eventFields("airbnb", reserved)).toEqual({ status: "confirmed", reservationCode: "HMABCD1234", phoneLast4: "5678" });
    expect(eventFields("airbnb", blocked).status).toBe("blocked");
  });

  it("Booking.com はすべて予約として扱う", () => {
    expect(eventFields("booking", parseIcal(BOOKING)[0]).status).toBe("confirmed");
  });
});

describe("planSync", () => {
  const today = "2026-10-01";
  const row = (over: Partial<ExistingReservation>): ExistingReservation => ({
    id: "r1",
    external_uid: "abc123@booking.com",
    check_in_date: "2026-10-10",
    check_out_date: "2026-10-12",
    status: "confirmed",
    status_locked: 0,
    reservation_code: null,
    phone_last4: null,
    ...over,
  });
  const events = parseIcal(BOOKING);

  it("新しい予約を追加する", () => {
    const plan = planSync("booking", events, [], today);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });

  it("変わっていなければ何も書かない", () => {
    expect(planSync("booking", events, [row({})], today)).toEqual({ inserts: [], updates: [], cancels: [] });
  });

  it("日程の変更を反映する", () => {
    const plan = planSync("booking", events, [row({ check_out_date: "2026-10-11" })], today);
    expect(plan.updates).toEqual([expect.objectContaining({ id: "r1", checkOutDate: "2026-10-12" })]);
  });

  it("UID が変わっても、同じ日程の予約と対応付けて URL（予約の行）を保つ", () => {
    const plan = planSync("booking", events, [row({ external_uid: "old-uid" })], today);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([expect.objectContaining({ id: "r1", uid: "abc123@booking.com" })]);
    expect(plan.cancels).toHaveLength(0);
  });

  it("iCal から消えた今後の予約をキャンセルにする。チェックイン済み（過去の日付）の予約はキャンセルにしない", () => {
    const gone = row({ id: "r2", external_uid: "gone", check_in_date: "2026-11-01", check_out_date: "2026-11-03" });
    const staying = row({ id: "r3", external_uid: "staying", check_in_date: "2026-09-30", check_out_date: "2026-10-02" });
    const plan = planSync("booking", events, [row({}), gone, staying], today);
    expect(plan.cancels.map((r) => r.id)).toEqual(["r2"]);
  });

  it("iCal が空のときはキャンセルにしない（取得の不具合に備える）", () => {
    expect(planSync("booking", [], [row({})], today).cancels).toHaveLength(0);
  });

  it("管理者がブロックに変えた予約は、状態を上書きしない", () => {
    const plan = planSync("booking", events, [row({ status: "blocked", status_locked: 1 })], today);
    expect(plan.updates).toHaveLength(0);
  });

  it("管理者がキャンセルにした予約は、iCal に残っていても次の取り込みでキャンセルのまま", () => {
    const plan = planSync("booking", events, [row({ status: "cancelled", status_locked: 1 })], today);
    expect(plan).toEqual({ inserts: [], updates: [], cancels: [] });
  });

  it("キャンセルになった予約が iCal に戻ってきたら、予約に戻す", () => {
    const plan = planSync("booking", events, [row({ status: "cancelled" })], today);
    expect(plan.updates).toEqual([expect.objectContaining({ id: "r1", status: "confirmed" })]);
  });

  it("過去の予約（チェックアウト日が今日より前）は扱わない", () => {
    const past = parseIcal(BOOKING.replace("20261010", "20260901").replace("20261012", "20260903"));
    expect(planSync("booking", past, [], today).inserts).toHaveLength(0);
  });
});
