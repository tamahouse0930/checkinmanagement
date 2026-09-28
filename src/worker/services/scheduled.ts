import { addDays, formatDateJa, jstNow } from "../../shared/dates";
import type { Env } from "../env";
import { Db } from "../lib/db";
import { getSettings } from "../lib/settings";
import { DAY_MS, nowIso } from "../lib/time";
import { deleteFile } from "./google/drive";
import { notifyHost } from "./notify";
import { purgeExpired, reconcilePhotos } from "./retention";
import { syncAll } from "./sync";

/** 1 日 1 回の処理を、その日にまだ実行していなければ実行済みとして記録し true を返す（設計書 4.11） */
async function claimDailyJob(db: Db, job: string, date: string): Promise<boolean> {
  const result = await db.run(db.prepare("INSERT OR IGNORE INTO job_runs (job, run_date) VALUES (?, ?)").bind(job, date));
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 作成から 7 日を過ぎたテスト予約を、名簿・写真（Google ドライブのフォルダ）ごと削除する（設計書 4.9）。
 * 部分索引 idx_reservations_test だけを使う。外部へのリクエストの上限に収まるよう、1 回に 20 件まで
 */
async function purgeTestReservations(env: Env, db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const rows = await db.all<{ id: string; drive_folder_id: string | null }>(
    db.prepare("SELECT id, drive_folder_id FROM reservations WHERE is_test = 1 AND created_at < ? LIMIT 20").bind(cutoff),
  );
  if (rows.length === 0) return;
  for (const r of rows) {
    if (r.drive_folder_id) await deleteFile(env, db, r.drive_folder_id).catch(() => undefined);
  }
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  await db.batch([
    db.prepare(`DELETE FROM guests WHERE reservation_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM photos WHERE reservation_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM reservations WHERE is_test = 1 AND id IN (${marks})`).bind(...ids),
  ]);
}

interface NoticeRow {
  id: string;
  check_in_date: string;
  check_out_date: string;
  display_name: string | null;
}

/** チェックアウト予定時刻を過ぎてもチェックアウトされていない予約を通知する（予約ごとに 1 回。要件定義書 5.5） */
async function notifyOverdueCheckouts(env: Env, db: Db, origin: string | null): Promise<void> {
  const now = jstNow();
  const { property } = await getSettings(db);
  const nowTime = `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;
  const rows = await db.all<NoticeRow>(
    db
      .prepare(
        `SELECT id, check_in_date, check_out_date, display_name FROM reservations
         WHERE check_out_date >= ? AND check_out_date <= ? AND stay_status = 'in_house' AND is_test = 0
           AND notified_overdue_at IS NULL LIMIT 10`,
      )
      .bind(addDays(now.date, -2), now.date),
  );
  const due = rows.filter((r) => r.check_out_date < now.date || nowTime >= property.checkout_time);
  if (due.length === 0) return;
  await db.batch(
    due.map((r) => db.prepare("UPDATE reservations SET notified_overdue_at = ? WHERE id = ?").bind(nowIso(), r.id)),
  );
  await notifyHost(env, db, {
    subject: "チェックアウトが未操作です",
    text: [
      "チェックアウトの予定時刻を過ぎても、タブレットでチェックアウトされていない予約があります。状況を確認してください。",
      "",
      ...due.map((r) => `・${formatDateJa(r.check_in_date)}〜${formatDateJa(r.check_out_date)} ${r.display_name ?? ""}${origin ? ` ${origin}/admin/reservations/${r.id}` : ""}`),
    ].join("\n"),
  });
}

/** 翌日チェックインなのに登録が済んでいない予約を通知する（毎日 18 時。要件定義書 5.5） */
async function notifyUnregistered(env: Env, db: Db, origin: string | null): Promise<void> {
  const tomorrow = addDays(jstNow().date, 1);
  const rows = await db.all<NoticeRow>(
    db
      .prepare(
        `SELECT id, check_in_date, check_out_date, display_name FROM reservations
         WHERE check_out_date > ? AND check_in_date = ? AND status = 'confirmed' AND is_test = 0
           AND reg_status IN ('none', 'in_progress', 'rejected') AND notified_unregistered_at IS NULL LIMIT 10`,
      )
      .bind(tomorrow, tomorrow),
  );
  if (rows.length === 0) return;
  await db.batch(
    rows.map((r) => db.prepare("UPDATE reservations SET notified_unregistered_at = ? WHERE id = ?").bind(nowIso(), r.id)),
  );
  await notifyHost(env, db, {
    subject: "明日チェックインの予約で、宿泊者の登録が済んでいません",
    text: [
      "予約サイトのメッセージで、宿泊者の登録をお願いしてください。",
      "",
      ...rows.map((r) => `・${formatDateJa(r.check_in_date)}〜${formatDateJa(r.check_out_date)} ${r.display_name ?? ""}${origin ? ` ${origin}/admin/reservations/${r.id}` : ""}`),
    ].join("\n"),
  });
}

export async function runScheduled(env: Env, origin: string | null = null): Promise<void> {
  const db = new Db(env.DB);
  const now = jstNow();
  try {
    if (now.hour >= 5 && (await claimDailyJob(db, "daily_morning", now.date))) {
      await syncAll(env, db);
      await purgeTestReservations(env, db);
    }
    // 3 年を過ぎた名簿・写真の削除と写真の突き合わせは、取り込みと別の実行（6 時以降）で行う。
    // 1 回の処理で外部へのリクエストは 50 件までという制限に収めるため
    if (now.hour >= 6 && (await claimDailyJob(db, "daily_cleanup", now.date))) {
      await purgeExpired(env, db);
      await reconcilePhotos(env, db).catch((e) => console.error(JSON.stringify({ event: "reconcile_failed", message: String(e) })));
    }
    if (now.hour >= 18 && (await claimDailyJob(db, "evening_unregistered", now.date))) {
      await notifyUnregistered(env, db, origin);
    }
    await notifyOverdueCheckouts(env, db, origin);
  } finally {
    console.log(
      JSON.stringify({
        event: "d1_usage",
        route: "scheduled",
        queries: db.queries,
        rows_read: db.rowsRead,
        rows_written: db.rowsWritten,
      }),
    );
  }
}
