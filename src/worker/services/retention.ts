import { addDays, jstNow } from "../../shared/dates";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import type { Db } from "../lib/db";
import { getSettings, invalidateSettings, PROPERTY_ID } from "../lib/settings";
import { nowIso } from "../lib/time";
import { deleteFile, listAppFileIds } from "./google/drive";

/**
 * 保存期間を過ぎた名簿と写真の削除（要件定義書 D-01〜D-03a、設計書 4.12）。
 * Workers の無料プランの制限（1 回の処理で外部へのリクエストは 50 件まで）に収まるよう、1 回に少しずつ削除し、
 * 残りは翌日に回す（件数は 1 日数件なので、1 回で追いつく）
 */

const BATCH = 10;

/** チェックアウト日から 3 年がたったかどうかの境目（この日以前のチェックアウト日が対象。写真の削除予定日と同じ日になる） */
export function retentionCutoff(today: string): string {
  const y = Number(today.slice(0, 4)) - 3;
  const rest = today.slice(4);
  return `${y}${rest === "-02-29" ? "-03-01" : rest}`;
}

interface Target {
  id: string;
  drive_folder_id: string | null;
}

/** 予約の名簿・写真・修正の記録を削除し、予約の行からは個人に結び付く値を消す */
async function purgeReservations(env: Env, db: Db, targets: Target[], action: string, clearCode: boolean): Promise<void> {
  if (targets.length === 0) return;
  for (const t of targets) {
    // 宿泊ごとのフォルダを消すと、中の写真もまとめて消える
    if (t.drive_folder_id) await deleteFile(env, db, t.drive_folder_id).catch(() => undefined);
  }
  const ids = targets.map((t) => t.id);
  const marks = ids.map(() => "?").join(",");
  await db.batch([
    db.prepare(`DELETE FROM guest_revisions WHERE reservation_id IN (${marks})`).bind(...ids),
    // 宿泊者が写真を参照しているため、宿泊者 → 写真の順に消す
    db.prepare(`DELETE FROM guests WHERE reservation_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM photos WHERE reservation_id IN (${marks})`).bind(...ids),
    db
      .prepare(
        `UPDATE reservations SET guest_token = NULL, phone_last4 = NULL, booker_name = NULL, keybox_code = NULL,
           display_name = NULL, reject_reason = NULL, note = NULL, drive_folder_id = NULL, guest_total = 0,
           guest_ready = 0, guest_pending = 0, guest_checked_in = 0
           ${clearCode ? ", reservation_code = NULL" : ""}, updated_at = ?
         WHERE id IN (${marks})`,
      )
      .bind(nowIso(), ...ids),
    auditStatement(db, "system", action, `${targets.length}件`),
  ]);
}

export async function purgeExpired(env: Env, db: Db): Promise<void> {
  const today = jstNow().date;

  // 1. チェックアウト日から 3 年を過ぎた予約（索引 idx_reservations_checkout の範囲で探す）
  const expired = await db.all<Target>(
    db
      .prepare(
        `SELECT id, drive_folder_id FROM reservations
         WHERE check_out_date <= ? AND (guest_total > 0 OR guest_token IS NOT NULL OR drive_folder_id IS NOT NULL) LIMIT ?`,
      )
      .bind(retentionCutoff(today), BATCH),
  );
  await purgeReservations(env, db, expired, "purge_expired", true);

  // 2. 予約サイト側でキャンセルされ、誰もチェックインしなかった予約（キャンセルから 7 日後。宿泊していないので保存の義務がない）
  const cancelled = await db.all<Target>(
    db
      .prepare(
        `SELECT id, drive_folder_id FROM reservations
         WHERE check_out_date >= ? AND status = 'cancelled' AND stay_status = 'not_arrived'
           AND (guest_total > 0 OR drive_folder_id IS NOT NULL) AND updated_at < ? LIMIT ?`,
      )
      .bind(addDays(today, -90), new Date(Date.now() - 7 * 86_400_000).toISOString(), BATCH),
  );
  await purgeReservations(env, db, cancelled, "purge_cancelled", false);

  // 3. 削除予定日を過ぎた写真が個別に残っていれば消す（索引 idx_photos_delete で探す）
  const photos = await db.all<{ id: string; guest_id: string; drive_file_id: string }>(
    db.prepare("SELECT id, guest_id, drive_file_id FROM photos WHERE delete_after <= ? LIMIT ?").bind(today, BATCH),
  );
  if (photos.length > 0) {
    for (const p of photos) await deleteFile(env, db, p.drive_file_id).catch(() => undefined);
    const ids = photos.map((p) => p.id);
    const guestIds = photos.map((p) => p.guest_id);
    await db.batch([
      db
        .prepare(
          `UPDATE guests SET id_photo_id = CASE WHEN id_photo_id IN (${ids.map(() => "?").join(",")}) THEN NULL ELSE id_photo_id END,
             kiosk_photo_id = CASE WHEN kiosk_photo_id IN (${ids.map(() => "?").join(",")}) THEN NULL ELSE kiosk_photo_id END
           WHERE id IN (${guestIds.map(() => "?").join(",")})`,
        )
        .bind(...ids, ...ids, ...guestIds),
      db.prepare(`DELETE FROM photos WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids),
      auditStatement(db, "system", "purge_photos", `${photos.length}件`),
    ]);
  }
}

/**
 * 写真の突き合わせ（設計書 4.13）。Google ドライブのファイルの一覧と写真台帳を比べ、見つからない写真に印を付ける。
 * 見つからない件数は要対応に表示する
 */
export async function reconcilePhotos(env: Env, db: Db): Promise<void> {
  const { googleLink } = await getSettings(db);
  if (!googleLink) return;
  const driveIds = await listAppFileIds(env, db);
  const photos = await db.all<{ id: string; drive_file_id: string; missing_at: string | null }>(
    db.prepare("SELECT id, drive_file_id, missing_at FROM photos LIMIT 10000"),
  );
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  let missing = 0;
  for (const p of photos) {
    const found = driveIds.has(p.drive_file_id);
    if (!found) missing += 1;
    // 変わったものだけを書く（設計書 DB-06）
    if (!found && !p.missing_at) stmts.push(db.prepare("UPDATE photos SET missing_at = ? WHERE id = ?").bind(now, p.id));
    if (found && p.missing_at) stmts.push(db.prepare("UPDATE photos SET missing_at = NULL WHERE id = ?").bind(p.id));
  }
  stmts.push(db.prepare("UPDATE properties SET missing_photo_count = ? WHERE id = ? AND missing_photo_count <> ?").bind(missing, PROPERTY_ID, missing));
  await db.batch(stmts);
  invalidateSettings();
}
