import type { ReservationStatus } from "../../shared/progress";

/** iCal の解析と、取り込み内容の差分計算（設計書 4.1）。D1 には触れない純粋な処理にしてテストしやすくする */

export interface IcalEvent {
  uid: string;
  start: string;
  end: string;
  summary: string;
  description: string;
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** DTSTART;VALUE=DATE:20261003 や 20261003T150000Z から YYYY-MM-DD を取り出す */
function parseDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseIcal(text: string): IcalEvent[] {
  // 折り返された行（次の行が空白で始まる）をつなげる
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { summary: "", description: "" };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.uid && current.start && current.end) events.push(current as IcalEvent);
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0].toUpperCase();
    const value = line.slice(colon + 1);
    switch (name) {
      case "UID":
        current.uid = value.trim();
        break;
      case "DTSTART":
        current.start = parseDate(value) ?? undefined;
        break;
      case "DTEND":
        current.end = parseDate(value) ?? undefined;
        break;
      case "SUMMARY":
        current.summary = unescapeText(value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeText(value);
        break;
    }
  }
  return events;
}

export interface EventFields {
  status: Exclude<ReservationStatus, "cancelled">;
  reservationCode: string | null;
  phoneLast4: string | null;
}

/** 予約かブロックかの判定と、Airbnb の予約コード・電話番号の下 4 桁の取り出し */
export function eventFields(channel: "airbnb" | "booking", event: IcalEvent): EventFields {
  if (channel === "booking") {
    // Booking.com は予約と販売停止日の区別がつかないため、すべて予約として取り込む（要件定義書 R-05）
    return { status: "confirmed", reservationCode: null, phoneLast4: null };
  }
  const blocked = /not available/i.test(event.summary) || !/reserved/i.test(event.summary);
  return {
    status: blocked ? "blocked" : "confirmed",
    reservationCode: /\/details\/([A-Z0-9]+)/i.exec(event.description)?.[1]?.toUpperCase() ?? null,
    phoneLast4: /Last 4 Digits\)?:\s*(\d{4})/i.exec(event.description)?.[1] ?? null,
  };
}

export interface ExistingReservation {
  id: string;
  external_uid: string | null;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
  status_locked: number;
  reservation_code: string | null;
  phone_last4: string | null;
}

export interface PlannedInsert extends EventFields {
  uid: string;
  checkInDate: string;
  checkOutDate: string;
}

export interface PlannedUpdate {
  id: string;
  uid: string;
  checkInDate: string;
  checkOutDate: string;
  status: ReservationStatus;
  reservationCode: string | null;
  phoneLast4: string | null;
}

export interface SyncPlan {
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  cancels: ExistingReservation[];
}

/**
 * iCal の内容と、登録済みの今後の予約を比べて、追加・更新・キャンセルを決める。
 * - UID で対応付ける。UID が変わった場合（予約サイト側の仕様）に備え、見つからなければ同じ日程の予約と対応付ける
 * - 管理者が状態を変えた予約（status_locked）は、状態を上書きしない
 * - キャンセルは、まだチェックインしていない予約だけ。iCal が空のときはキャンセルしない（取得の不具合に備える）
 */
export function planSync(
  channel: "airbnb" | "booking",
  events: IcalEvent[],
  existing: ExistingReservation[],
  today: string,
): SyncPlan {
  const plan: SyncPlan = { inserts: [], updates: [], cancels: [] };
  const relevant = events.filter((e) => e.end > e.start && e.end >= today);
  const byUid = new Map(existing.filter((r) => r.external_uid).map((r) => [r.external_uid!, r]));
  const matched = new Set<string>();
  const unmatched: IcalEvent[] = [];

  const applyUpdate = (row: ExistingReservation, event: IcalEvent) => {
    matched.add(row.id);
    const fields = eventFields(channel, event);
    const status: ReservationStatus = row.status_locked ? row.status : fields.status;
    const update: PlannedUpdate = {
      id: row.id,
      uid: event.uid,
      checkInDate: event.start,
      checkOutDate: event.end,
      status,
      reservationCode: fields.reservationCode ?? row.reservation_code,
      phoneLast4: fields.phoneLast4 ?? row.phone_last4,
    };
    const changed =
      row.external_uid !== update.uid ||
      row.check_in_date !== update.checkInDate ||
      row.check_out_date !== update.checkOutDate ||
      row.status !== update.status ||
      row.reservation_code !== update.reservationCode ||
      row.phone_last4 !== update.phoneLast4;
    // 変わっていなければ書かない（設計書 DB-06）
    if (changed) plan.updates.push(update);
  };

  for (const event of relevant) {
    const row = byUid.get(event.uid);
    if (row && !matched.has(row.id)) applyUpdate(row, event);
    else unmatched.push(event);
  }

  for (const event of unmatched) {
    const row = existing.find(
      (r) => !matched.has(r.id) && r.check_in_date === event.start && r.check_out_date === event.end,
    );
    if (row) {
      applyUpdate(row, event);
    } else {
      plan.inserts.push({ uid: event.uid, checkInDate: event.start, checkOutDate: event.end, ...eventFields(channel, event) });
    }
  }

  if (events.length > 0) {
    plan.cancels = existing.filter(
      (r) => !matched.has(r.id) && r.status !== "cancelled" && r.check_in_date >= today,
    );
  }
  return plan;
}
