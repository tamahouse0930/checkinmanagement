import { addDays, formatDateJa, jstNow } from "../../shared/dates";
import type { Env } from "../env";
import { Db } from "../lib/db";
import { getSettings } from "../lib/settings";
import { DAY_MS, nowIso } from "../lib/time";
import { notifyHost } from "./notify";
import { DRIVE_DELETE_BUDGET, type DriveBudget, purgeExpired, purgeHousekeeping, reconcilePhotos, removeFromDrive } from "./retention";
import { syncAll } from "./sync";

/** 1 日 1 回の処理を、その日にまだ実行していなければ実行済みとして記録し true を返す（設計書 4.11） */
async function claimDailyJob(db: Db, job: string, date: string): Promise<boolean> {
  const result = await db.run(db.prepare("INSERT OR IGNORE INTO job_runs (job, run_date) VALUES (?, ?)").bind(job, date));
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 作成から 7 日を過ぎたテスト予約を、名簿・写真（Google ドライブのフォルダ）ごと削除する（設計書 4.9）。
 * 部分索引 idx_reservations_test だけを使う。外部へのリクエストの上限に収まるよう、ドライブの削除は 1 回に
 * DRIVE_DELETE_BUDGET 件まで。ドライブから消せたものだけを消す（残りは翌日）
 */
async function purgeTestReservations(env: Env, db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const rows = await db.all<{ id: string; drive_folder_id: string | null }>(
    db.prepare("SELECT id, drive_folder_id FROM reservations WHERE is_test = 1 AND created_at < ? LIMIT 20").bind(cutoff),
  );
  if (rows.length === 0) return;
  const budget: DriveBudget = { left: DRIVE_DELETE_BUDGET };
  const done: string[] = [];
  for (const r of rows) {
    if (await removeFromDrive(env, db, r.drive_folder_id, budget)) done.push(r.id);
  }
  if (done.length === 0) return;
  const ids = done;
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
}

/** チェックアウト予定時刻を過ぎてもチェックアウトされていない予約を通知する（予約ごとに 1 回。要件定義書 5.5） */
async function notifyOverdueCheckouts(env: Env, db: Db, origin: string | null): Promise<void> {
  const now = jstNow();
  const { property } = await getSettings(db);
  const nowTime = `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;
  const rows = await db.all<NoticeRow>(
    db
      .prepare(
        `SELECT id, check_in_date, check_out_date FROM reservations
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
      ...due.map((r) => `・${formatDateJa(r.check_in_date)}〜${formatDateJa(r.check_out_date)}${origin ? ` ${origin}/admin/reservations/${r.id}` : ""}`),
    ].join("\n"),
  });
}

/** 翌日チェックインなのに登録が済んでいない予約を通知する（毎日 18 時。要件定義書 5.5） */
async function notifyUnregistered(env: Env, db: Db, origin: string | null): Promise<void> {
  const tomorrow = addDays(jstNow().date, 1);
  const rows = await db.all<NoticeRow>(
    db
      .prepare(
        `SELECT id, check_in_date, check_out_date FROM reservations
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
      ...rows.map((r) => `・${formatDateJa(r.check_in_date)}〜${formatDateJa(r.check_out_date)}${origin ? ` ${origin}/admin/reservations/${r.id}` : ""}`),
    ].join("\n"),
  });
}

export async function runScheduled(env: Env, origin: string | null = null): Promise<void> {
  const db = new Db(env.DB);
  const now = jstNow();
  try {
    // 毎日の処理は、1 回の実行で 1 つだけ行う（15 分ごとの実行で順に片付く）。1 回の処理の上限
    // （外部へのリクエスト 50 件、D1 の問い合わせ 50 件）に、それぞれ収めるため。
    // 取り込み（5 時以降）→ 保存期間を過ぎた名簿・写真の削除（6 時以降）→ 写真の突き合わせ（7 時以降）→ 前日未登録の通知（18 時以降）
    if (now.hour >= 5 && (await claimDailyJob(db, "daily_morning", now.date))) {
      await syncAll(env, db);
      await purgeTestReservations(env, db);
    } else if (now.hour >= 6 && (await claimDailyJob(db, "daily_cleanup", now.date))) {
      await purgeExpired(env, db);
      await purgeHousekeeping(db);
    } else if (now.hour >= 7 && (await claimDailyJob(db, "daily_reconcile", now.date))) {
      await reconcilePhotos(env, db).catch((e) => console.error(JSON.stringify({ event: "reconcile_failed", message: String(e) })));
    } else if (now.hour >= 18 && (await claimDailyJob(db, "evening_unregistered", now.date))) {
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
