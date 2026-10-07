import { addDays, jstNow } from "../../shared/dates";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import type { Db } from "../lib/db";
import { getSettings, invalidateSettings, PROPERTY_ID } from "../lib/settings";
import { DAY_MS, nowIso } from "../lib/time";
import { deleteFile, listAppFileIds } from "./google/drive";

/**
 * 保存期間を過ぎた名簿と写真の削除（要件定義書 D-01〜D-03a、設計書 4.12）。
 * Workers の無料プランの制限（1 回の処理で外部へのリクエストは 50 件まで、D1 の問い合わせは 50 件まで）に収まるよう、
 * 1 回に少しずつ削除し、残りは翌日に回す（件数は 1 日数件なので、1 回で追いつく）
 */

const BATCH = 10;

/**
 * 1 回の処理で Google ドライブに送る削除の上限。外部へのリクエストの上限（50 件）に、トークンの取得や通知のメールの分の
 * 余裕を残す
 */
export const DRIVE_DELETE_BUDGET = 15;

/** 1 回の処理で残っているドライブの削除の回数 */
export interface DriveBudget {
  left: number;
}

/**
 * ドライブのファイル（フォルダ）を削除する。消せたか、もともとなければ true。
 * 失敗したとき（一時的な障害、外部へのリクエストの上限など）や、この回の上限に達したときは false を返し、
 * 呼び出し元は名簿を消さずに翌日にやり直す（名簿だけ消すと、写真が二度と削除されずにドライブに残るため）
 */
export async function removeFromDrive(env: Env, db: Db, fileId: string | null, budget: DriveBudget): Promise<boolean> {
  if (!fileId) return true;
  if (budget.left <= 0) return false;
  budget.left -= 1;
  try {
    await deleteFile(env, db, fileId);
    return true;
  } catch (e) {
    console.error(JSON.stringify({ event: "drive_delete_failed", message: String(e) }));
    return false;
  }
}

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

/**
 * 予約の名簿・写真・修正の記録を削除し、予約の行からは個人に結び付く値を消す。
 * ドライブのフォルダ（中の写真ごと）を消せた予約だけを対象にする
 */
async function purgeReservations(env: Env, db: Db, targets: Target[], action: string, clearCode: boolean, budget: DriveBudget): Promise<void> {
  const done: Target[] = [];
  for (const t of targets) {
    if (await removeFromDrive(env, db, t.drive_folder_id, budget)) done.push(t);
  }
  if (done.length === 0) return;
  const ids = done.map((t) => t.id);
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
    auditStatement(db, "system", action, `${done.length}件`),
  ]);
}

export async function purgeExpired(env: Env, db: Db): Promise<void> {
  const today = jstNow().date;
  const budget: DriveBudget = { left: DRIVE_DELETE_BUDGET };

  // 1. チェックアウト日から 3 年を過ぎた予約（索引 idx_reservations_checkout の範囲で探す）
  const expired = await db.all<Target>(
    db
      .prepare(
        `SELECT id, drive_folder_id FROM reservations
         WHERE check_out_date <= ? AND (guest_total > 0 OR guest_token IS NOT NULL OR drive_folder_id IS NOT NULL) LIMIT ?`,
      )
      .bind(retentionCutoff(today), BATCH),
  );
  await purgeReservations(env, db, expired, "purge_expired", true, budget);

  // 2. 予約サイト側でキャンセルされ、誰もチェックインしなかった予約（キャンセルから 7 日後。宿泊していないので保存の義務がない）
  const cancelled = await db.all<Target>(
    db
      .prepare(
        `SELECT id, drive_folder_id FROM reservations
         WHERE check_out_date >= ? AND status = 'cancelled' AND stay_status = 'not_arrived'
           AND (guest_total > 0 OR drive_folder_id IS NOT NULL) AND updated_at < ? LIMIT ?`,
      )
      .bind(addDays(today, -90), new Date(Date.now() - 7 * DAY_MS).toISOString(), BATCH),
  );
  await purgeReservations(env, db, cancelled, "purge_cancelled", false, budget);

  // 3. 泊まらなかった予約（チェックアウト日を過ぎても誰もチェックインしなかった予約）。宿泊していないので保存の義務がない。
  //    当日の朝に消すと、タブレットを使わずに泊まっている人の名簿まで消えるおそれがあるため、チェックアウト日の翌日に消す。
  //    管理画面でチェックアウトを記録した予約（stay_status が checked_out）は泊まったものとして扱い、消さない
  const noShows = await db.all<Target>(
    db
      .prepare(
        `SELECT id, drive_folder_id FROM reservations
         WHERE check_out_date < ? AND check_out_date > ? AND status = 'confirmed' AND stay_status = 'not_arrived'
           AND first_checkin_at IS NULL AND guest_checked_in = 0
           AND (guest_total > 0 OR drive_folder_id IS NOT NULL) LIMIT ?`,
      )
      .bind(today, retentionCutoff(today), BATCH),
  );
  await purgeReservations(env, db, noShows, "purge_no_show", false, budget);

  // 4. 削除予定日を過ぎた写真が個別に残っていれば消す（索引 idx_photos_delete で探す）。ドライブから消せたものだけ台帳から消す
  const photos = await db.all<{ id: string; guest_id: string; drive_file_id: string }>(
    db.prepare("SELECT id, guest_id, drive_file_id FROM photos WHERE delete_after <= ? LIMIT ?").bind(today, BATCH),
  );
  const removed: typeof photos = [];
  for (const p of photos) {
    if (await removeFromDrive(env, db, p.drive_file_id, budget)) removed.push(p);
  }
  if (removed.length > 0) {
    const ids = removed.map((p) => p.id);
    const guestIds = removed.map((p) => p.guest_id);
    await db.batch([
      db
        .prepare(
          `UPDATE guests SET id_photo_id = CASE WHEN id_photo_id IN (${ids.map(() => "?").join(",")}) THEN NULL ELSE id_photo_id END,
             kiosk_photo_id = CASE WHEN kiosk_photo_id IN (${ids.map(() => "?").join(",")}) THEN NULL ELSE kiosk_photo_id END
           WHERE id IN (${guestIds.map(() => "?").join(",")})`,
        )
        .bind(...ids, ...ids, ...guestIds),
      db.prepare(`DELETE FROM photos WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids),
      auditStatement(db, "system", "purge_photos", `${removed.length}件`),
    ]);
  }
}

/**
 * 期限を過ぎた管理用の記録を片付ける（個人情報は含まないが、溜まり続けると一覧や集計で読む行数が増えるため）。
 * ログインの記録は有効期限切れ、定期処理の実行の記録は 30 日より前、操作ログは 3 年より前のもの
 */
export async function purgeHousekeeping(db: Db): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(new Date(now).toISOString()),
    db.prepare("DELETE FROM job_runs WHERE run_date < ?").bind(addDays(jstNow().date, -30)),
    db.prepare("DELETE FROM audit_logs WHERE created_at < ?").bind(new Date(now - 3 * 365 * DAY_MS).toISOString()),
  ]);
}

/** 写真の突き合わせで、1 文でまとめて更新する写真の数（D1 の 1 文の値の上限 100 件に収める） */
const RECONCILE_CHUNK = 90;
/** 写真の突き合わせで、1 回に実行する更新の文の上限（D1 の 1 回の処理の問い合わせの上限 50 件に収める）。残りは翌日 */
const RECONCILE_MAX_STATEMENTS = 30;

/**
 * 写真の突き合わせの判定。新しく見つからなくなった写真、見つかるようになった写真、見つからない写真の数を返す。
 * ドライブの一覧が途中まで（complete が false）のときは、新しく「見つからない」とはしない（一覧にないだけで、消えたとは限らない）。
 * そのときの見つからない数は、前から印が付いていて、今回も一覧になかったものだけ
 */
export function planReconcile(
  photos: { id: string; drive_file_id: string; missing_at: string | null }[],
  driveIds: Set<string>,
  complete: boolean,
): { nowMissing: string[]; nowFound: string[]; missing: number } {
  const nowMissing: string[] = [];
  const nowFound: string[] = [];
  let missing = 0;
  for (const p of photos) {
    const found = driveIds.has(p.drive_file_id);
    if (found) {
      if (p.missing_at) nowFound.push(p.id);
      continue;
    }
    if (complete) {
      missing += 1;
      if (!p.missing_at) nowMissing.push(p.id);
    } else if (p.missing_at) {
      missing += 1;
    }
  }
  return { nowMissing, nowFound, missing };
}

/**
 * 写真の突き合わせ（設計書 4.13）。Google ドライブのファイルの一覧と写真台帳を比べ、見つからない写真に印を付ける。
 * 見つからない件数は要対応に表示する。変わった写真だけを、まとめて更新する（設計書 DB-06）。
 * ドライブの一覧を最後まで取れなかったときは、新しく「見つからない」印は付けない（一覧にないだけで、消えたとは限らないため）
 */
export async function reconcilePhotos(env: Env, db: Db): Promise<void> {
  const { googleLinks } = await getSettings(db);
  if (!googleLinks.drive) return;
  const drive = await listAppFileIds(env, db);
  const photos = await db.all<{ id: string; drive_file_id: string; missing_at: string | null }>(
    db.prepare("SELECT id, drive_file_id, missing_at FROM photos LIMIT 10000"),
  );
  const { nowMissing, nowFound, missing } = planReconcile(photos, drive.ids, drive.complete);

  const stmts: D1PreparedStatement[] = [];
  const now = nowIso();
  const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / RECONCILE_CHUNK) }, (_, i) => ids.slice(i * RECONCILE_CHUNK, (i + 1) * RECONCILE_CHUNK));
  for (const ids of chunks(nowFound)) {
    stmts.push(db.prepare(`UPDATE photos SET missing_at = NULL WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids));
  }
  for (const ids of chunks(nowMissing)) {
    stmts.push(db.prepare(`UPDATE photos SET missing_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`).bind(now, ...ids));
  }
  const limited = stmts.slice(0, RECONCILE_MAX_STATEMENTS);
  if (limited.length < stmts.length) {
    console.log(JSON.stringify({ event: "reconcile_deferred", statements: stmts.length - limited.length }));
  }
  limited.push(db.prepare("UPDATE properties SET missing_photo_count = ? WHERE id = ? AND missing_photo_count <> ?").bind(missing, PROPERTY_ID, missing));
  await db.batch(limited);
  invalidateSettings();
}
