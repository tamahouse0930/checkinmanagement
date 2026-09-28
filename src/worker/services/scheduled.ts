import { jstNow } from "../../shared/dates";
import type { Env } from "../env";
import { Db } from "../lib/db";
import { DAY_MS } from "../lib/time";
import { syncAll } from "./sync";

/** 1 日 1 回の処理を、その日にまだ実行していなければ実行済みとして記録し true を返す（設計書 4.11） */
async function claimDailyJob(db: Db, job: string, date: string): Promise<boolean> {
  const result = await db.run(db.prepare("INSERT OR IGNORE INTO job_runs (job, run_date) VALUES (?, ?)").bind(job, date));
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 作成から 7 日を過ぎたテスト予約を削除する（設計書 4.9）。部分索引 idx_reservations_test だけを使う。
 * Google ドライブの写真の削除は、写真を扱う段階で追加する。
 */
async function purgeTestReservations(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const target = "SELECT id FROM reservations WHERE is_test = 1 AND created_at < ?";
  await db.batch([
    db.prepare(`DELETE FROM guests WHERE reservation_id IN (${target})`).bind(cutoff),
    db.prepare(`DELETE FROM photos WHERE reservation_id IN (${target})`).bind(cutoff),
    db.prepare("DELETE FROM reservations WHERE is_test = 1 AND created_at < ?").bind(cutoff),
  ]);
}

export async function runScheduled(env: Env): Promise<void> {
  const db = new Db(env.DB);
  const now = jstNow();
  try {
    if (now.hour >= 5 && (await claimDailyJob(db, "daily_morning", now.date))) {
      await syncAll(env, db);
      await purgeTestReservations(db);
    }
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
