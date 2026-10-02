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
  /** 1 回に反映する件数の上限を超えたため、次の取り込みに回した件数 */
  remaining: number;
}

/**
 * 1 回の取り込み（すべての取得元の合計）で反映する予約の件数の上限。1 件ごとに 1 文を実行するため、
 * D1 の 1 回の処理の問い合わせの上限（50 件。一括実行の文も 1 件ずつ数える）に、設定の読み込みや通知などの分を残して収める。
 * 残りは次の取り込みで反映する（取り込みのたびに差分を計算し直すので、何回か取り込めばそろう）
 */
export const MAX_SYNC_CHANGES = 25;

async function fetchIcal(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "checkin-management/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * 1 つの取得元を取り込む。D1 への問い合わせは「読み取り 1 回 ＋ 書き込み 1 回（一括）」。
 * 反映する件数は budget の残りまで（残りは次の取り込み）
 */
export async function syncSource(db: Db, source: IcalSource, today: string, budget: { left: number }): Promise<SourceResult> {
  const result: SourceResult = { channel: source.channel, added: 0, updated: 0, cancelled: 0, error: null, cancelledDates: [], remaining: 0 };
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
  const planned = planSync(source.channel, events, existing, today);
  // 上限を超えた分は次の取り込みに回す（新しい予約 → 変更 → キャンセルの順に反映する）
  const total = planned.inserts.length + planned.updates.length + planned.cancels.length;
  const take = <T,>(list: T[]): T[] => {
    const part = list.slice(0, Math.max(0, budget.left));
    budget.left -= part.length;
    return part;
  };
  const plan = { inserts: take(planned.inserts), updates: take(planned.updates), cancels: take(planned.cancels) };
  result.remaining = total - plan.inserts.length - plan.updates.length - plan.cancels.length;

  const stmts: D1PreparedStatement[] = [];
  // 暗証番号は、予約の電話番号の下 4 桁（Airbnb）を初期値にする。管理者が入力した番号は上書きしない（要件定義書 H-14）
  for (const ins of plan.inserts) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO reservations (id, property_id, ical_source_id, channel, source, external_uid, reservation_code, phone_last4,
             keybox_code, check_in_date, check_out_date, status, guest_token, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ical', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          PROPERTY_ID,
          source.id,
          source.channel,
          ins.uid,
          ins.reservationCode,
          ins.phoneLast4,
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
             reservation_code = ?, phone_last4 = ?, keybox_code = COALESCE(keybox_code, ?),
             guest_token = CASE WHEN status = 'cancelled' AND ? = 'confirmed' THEN COALESCE(guest_token, ?) ELSE guest_token END,
             updated_at = ? WHERE id = ?`,
        )
        // キャンセルから予約に戻った場合だけ、URL がなければ作り直す。宿泊者が送信して URL を使えなくした予約では作り直さない
        // （CASE の status は更新前の値）
        .bind(up.uid, up.checkInDate, up.checkOutDate, up.status, up.reservationCode, up.phoneLast4, up.phoneLast4, up.status, randomToken(), now, up.id),
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
  const budget = { left: MAX_SYNC_CHANGES };
  for (const source of sources) results.push(await syncSource(db, source, today, budget));
  const remaining = results.reduce((n, r) => n + r.remaining, 0);
  if (remaining > 0) console.log(JSON.stringify({ event: "sync_deferred", remaining }));

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
