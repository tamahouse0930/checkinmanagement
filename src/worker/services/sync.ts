import { formatDateJa, jstNow } from "../../shared/dates";
import type { Channel } from "../../shared/progress";
import type { Env } from "../env";
import { randomToken } from "../lib/crypto";
import type { Db } from "../lib/db";
import { PROPERTY_ID } from "../lib/settings";
import { nowIso } from "../lib/time";
import { type ExistingReservation, parseIcal, planSync } from "./ical";
import { notifyHost } from "./notify";

interface IcalSource {
  id: string;
  channel: "airbnb" | "booking";
  url: string;
}

export interface SourceResult {
  channel: Channel;
  added: number;
  updated: number;
  cancelled: number;
  error: string | null;
  cancelledDates: string[];
}

async function fetchIcal(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "checkin-management/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** 1 つの取得元を取り込む。D1 への問い合わせは「読み取り 1 回 ＋ 書き込み 1 回（一括）」 */
export async function syncSource(db: Db, source: IcalSource, today: string): Promise<SourceResult> {
  const result: SourceResult = { channel: source.channel, added: 0, updated: 0, cancelled: 0, error: null, cancelledDates: [] };
  const now = nowIso();

  let text: string;
  try {
    text = await fetchIcal(source.url);
  } catch (error) {
    result.error = `iCal を取得できませんでした（${error instanceof Error ? error.message : String(error)}）`;
    await db.run(db.prepare("UPDATE ical_sources SET last_error = ? WHERE id = ?").bind(result.error, source.id));
    return result;
  }

  const events = parseIcal(text);
  // 今後の予約だけを索引（check_out_date）で読む（設計書 DB-01）
  const existing = await db.all<ExistingReservation>(
    db
      .prepare(
        `SELECT id, external_uid, check_in_date, check_out_date, status, status_locked, reservation_code, phone_last4
         FROM reservations WHERE check_out_date >= ? AND ical_source_id = ? LIMIT 1000`,
      )
      .bind(today, source.id),
  );
  const plan = planSync(source.channel, events, existing, today);

  const stmts: D1PreparedStatement[] = [];
  for (const ins of plan.inserts) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO reservations (id, property_id, ical_source_id, channel, source, external_uid, reservation_code, phone_last4,
             check_in_date, check_out_date, status, guest_token, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ical', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          PROPERTY_ID,
          source.id,
          source.channel,
          ins.uid,
          ins.reservationCode,
          ins.phoneLast4,
          ins.checkInDate,
          ins.checkOutDate,
          ins.status,
          randomToken(),
          now,
          now,
        ),
    );
  }
  for (const up of plan.updates) {
    stmts.push(
      db
        .prepare(
          `UPDATE reservations SET external_uid = ?, check_in_date = ?, check_out_date = ?, status = ?,
             reservation_code = ?, phone_last4 = ?, guest_token = COALESCE(guest_token, ?), updated_at = ? WHERE id = ?`,
        )
        // 以前アプリの中でキャンセルにして URL を消した予約が、予約として戻ってきた場合に備えて URL を作り直す
        .bind(up.uid, up.checkInDate, up.checkOutDate, up.status, up.reservationCode, up.phoneLast4, randomToken(), now, up.id),
    );
  }
  for (const row of plan.cancels) {
    stmts.push(db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, row.id));
  }
  stmts.push(db.prepare("UPDATE ical_sources SET last_synced_at = ?, last_error = NULL WHERE id = ?").bind(now, source.id));
  await db.batch(stmts);

  result.added = plan.inserts.length;
  result.updated = plan.updates.length;
  result.cancelled = plan.cancels.length;
  result.cancelledDates = plan.cancels
    .filter((r) => r.status === "confirmed")
    .map((r) => `${formatDateJa(r.check_in_date)}〜${formatDateJa(r.check_out_date)}`);
  return result;
}

/** すべての取得元を取り込み、キャンセルと取得の失敗を管理者に通知する */
export async function syncAll(env: Env, db: Db): Promise<SourceResult[]> {
  const today = jstNow().date;
  const sources = await db.all<IcalSource>(db.prepare("SELECT id, channel, url FROM ical_sources LIMIT 10"));
  const results: SourceResult[] = [];
  for (const source of sources) results.push(await syncSource(db, source, today));

  const lines: string[] = [];
  for (const r of results) {
    const name = r.channel === "airbnb" ? "Airbnb" : "Booking.com";
    if (r.error) lines.push(`【取り込みの失敗】${name}: ${r.error}`);
    for (const d of r.cancelledDates) lines.push(`【キャンセル】${name}: ${d}`);
  }
  if (lines.length > 0) {
    await notifyHost(env, db, {
      subject: "予約の取り込みで確認が必要なことがあります",
      text: [...lines, "", "管理画面のカレンダーで確認してください。"].join("\n"),
    });
  }
  return results;
}
