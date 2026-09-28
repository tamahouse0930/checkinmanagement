import { Hono, type Context } from "hono";
import { z } from "zod";
import type { CalendarResponse, ReservationDetail, ReservationSummary, SyncResponse } from "../../shared/api-types";
import { diffDays, isValidDate, isValidMonth, jstNow, monthRange } from "../../shared/dates";
import {
  ATTENTION_KEYS,
  type AttentionKey,
  type Channel,
  progressOf,
  type ProgressInput,
  type RegStatus,
  type ReservationStatus,
  type StayStatus,
} from "../../shared/progress";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { randomToken } from "../lib/crypto";
import { getSettings, PROPERTY_ID } from "../lib/settings";
import { nowIso } from "../lib/time";
import { syncAll } from "../services/sync";

/** カレンダー・一覧に必要な列だけ（宿泊者の個人情報は含めない） */
const SUMMARY_COLUMNS = `id, channel, source, is_test, reservation_code, booker_name, display_name, check_in_date, check_out_date,
  status, reg_status, stay_status, invite_sent_at, code_sent_at, guest_total, guest_pending, guest_checked_in`;

interface SummaryRow extends ProgressInput {
  id: string;
  channel: Channel;
  source: "ical" | "manual";
  is_test: number;
  reservation_code: string | null;
  booker_name: string | null;
  display_name: string | null;
  check_in_date: string;
  check_out_date: string;
  guest_total: number;
  guest_checked_in: number;
}

interface DetailRow extends SummaryRow {
  phone_last4: string | null;
  note: string | null;
  status_locked: number;
  guest_token: string | null;
  created_at: string;
  updated_at: string;
}

function toSummary(r: SummaryRow): ReservationSummary {
  return {
    id: r.id,
    channel: r.channel,
    source: r.source,
    isTest: r.is_test === 1,
    reservationCode: r.reservation_code,
    label: r.booker_name ?? r.display_name,
    checkInDate: r.check_in_date,
    checkOutDate: r.check_out_date,
    status: r.status as ReservationStatus,
    progress: progressOf(r),
    guestTotal: r.guest_total,
    guestCheckedIn: r.guest_checked_in,
  };
}

function toDetail(c: Context<AppEnv>, r: DetailRow): ReservationDetail {
  return {
    ...toSummary(r),
    phoneLast4: r.phone_last4,
    bookerName: r.booker_name,
    note: r.note,
    statusLocked: r.status_locked === 1,
    regStatus: r.reg_status as RegStatus,
    stayStatus: r.stay_status as StayStatus,
    guestUrl: r.guest_token ? `${new URL(c.req.url).origin}/r/${r.guest_token}` : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

function notFound() {
  return { error: { code: "not_found", message: "予約が見つかりません" } };
}

async function loadDetail(c: Context<AppEnv>, id: string): Promise<DetailRow | null> {
  const db = c.var.db;
  return db.first<DetailRow>(db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id));
}

export const reservationRoutes = new Hono<AppEnv>();

/** カレンダー（1 か月）と要対応の件数。1 回の一括実行で取得する（設計書 11.2） */
reservationRoutes.get("/calendar", async (c) => {
  const month = c.req.query("month") ?? jstNow().date.slice(0, 7);
  if (!isValidMonth(month)) return c.json(badRequest("月の指定が不正です"), 400);
  const { start, end } = monthRange(month);
  const today = jstNow().date;
  const db = c.var.db;

  const [monthRows, upcomingRows, sources] = await db.batch([
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM reservations
         WHERE check_out_date >= ? AND check_in_date <= ? ORDER BY check_in_date LIMIT 300`,
      )
      .bind(start, end),
    db
      .prepare(
        `SELECT status, reg_status, stay_status, invite_sent_at, code_sent_at, guest_pending FROM reservations
         WHERE check_out_date >= ? AND is_test = 0 AND status = 'confirmed' LIMIT 500`,
      )
      .bind(today),
    db.prepare("SELECT channel, last_error FROM ical_sources LIMIT 10"),
  ]);

  const attention = Object.fromEntries(ATTENTION_KEYS.map((k) => [k, 0])) as Record<AttentionKey, number>;
  for (const row of upcomingRows.results as ProgressInput[]) {
    const key = progressOf(row);
    if ((ATTENTION_KEYS as readonly string[]).includes(key)) attention[key as AttentionKey] += 1;
  }

  const alerts: string[] = [];
  for (const s of sources.results as { channel: Channel; last_error: string | null }[]) {
    if (s.last_error) alerts.push(`${s.channel === "airbnb" ? "Airbnb" : "Booking.com"} の取り込み: ${s.last_error}`);
  }
  const { googleLink } = await getSettings(db);
  if (!googleLink) alerts.push("Google ドライブ・Gmail と連携されていません（設定画面から連携してください）");
  else if (googleLink.last_error) alerts.push(googleLink.last_error);

  const body: CalendarResponse = {
    month,
    today,
    reservations: (monthRows.results as SummaryRow[]).map(toSummary),
    attention,
    alerts,
  };
  return c.json(body);
});

/** 最新化（iCal の取り込み。要件定義書 R-02） */
reservationRoutes.post("/reservations/sync", async (c) => {
  const results = await syncAll(c.env, c.var.db);
  const body: SyncResponse = {
    results: results.map((r) => ({
      channel: r.channel,
      added: r.added,
      updated: r.updated,
      cancelled: r.cancelled,
      error: r.error,
    })),
  };
  return c.json(body);
});

const dateSchema = z.string().refine(isValidDate, "日付が不正です");
const manualSchema = z
  .object({
    checkInDate: dateSchema,
    checkOutDate: dateSchema,
    channel: z.enum(["airbnb", "booking", "other"]),
    bookerName: z.string().trim().max(50).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => diffDays(v.checkInDate, v.checkOutDate) >= 1, "チェックアウト日はチェックイン日より後にしてください")
  .refine((v) => diffDays(v.checkInDate, v.checkOutDate) <= 60, "宿泊は 60 泊までです");

/** 手動登録・テスト予約の作成（要件定義書 R-06、H-32） */
reservationRoutes.post("/reservations", async (c) => {
  const body = await c.req.json();
  const parsed = manualSchema.safeParse(body);
  if (!parsed.success) return c.json(badRequest(parsed.error.issues[0]?.message ?? "入力内容を確認してください"), 400);
  const isTest = body?.isTest === true;
  const v = parsed.data;
  const id = crypto.randomUUID();
  const now = nowIso();
  const db = c.var.db;
  await db.batch([
    db
      .prepare(
        `INSERT INTO reservations (id, property_id, channel, source, is_test, booker_name, display_name, note,
           check_in_date, check_out_date, status, guest_token, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      )
      .bind(
        id,
        PROPERTY_ID,
        v.channel,
        isTest ? 1 : 0,
        v.bookerName || null,
        v.bookerName || null,
        v.note || null,
        v.checkInDate,
        v.checkOutDate,
        randomToken(),
        now,
        now,
      ),
    auditStatement(db, `admin:${c.var.admin.email}`, isTest ? "create_test_reservation" : "create_reservation", id),
  ]);
  return c.json({ id }, 201);
});

reservationRoutes.get("/reservations/:id", async (c) => {
  const row = await loadDetail(c, c.req.param("id"));
  if (!row) return c.json(notFound(), 404);
  return c.json(toDetail(c, row));
});

/**
 * 予約の変更。
 * - 取り込んだ予約: 予約／ブロックの切り替えだけ（以後の取り込みで上書きしない）
 * - 手動登録・テスト予約: 日程・経路・代表者名・メモ
 */
reservationRoutes.patch("/reservations/:id", async (c) => {
  const id = c.req.param("id");
  const row = await loadDetail(c, id);
  if (!row) return c.json(notFound(), 404);
  const body = await c.req.json();
  const db = c.var.db;
  const now = nowIso();
  const actor = `admin:${c.var.admin.email}`;

  if (row.source === "ical") {
    const parsed = z.object({ status: z.enum(["confirmed", "blocked"]) }).safeParse(body);
    if (!parsed.success) return c.json(badRequest("取り込んだ予約は、予約／ブロックの切り替えだけができます"), 400);
    await db.batch([
      db
        .prepare("UPDATE reservations SET status = ?, status_locked = 1, updated_at = ? WHERE id = ?")
        .bind(parsed.data.status, now, id),
      auditStatement(db, actor, `set_status_${parsed.data.status}`, id),
    ]);
    return c.json({ ok: true });
  }

  const parsed = manualSchema.safeParse(body);
  if (!parsed.success) return c.json(badRequest(parsed.error.issues[0]?.message ?? "入力内容を確認してください"), 400);
  const v = parsed.data;
  await db.batch([
    db
      .prepare(
        `UPDATE reservations SET check_in_date = ?, check_out_date = ?, channel = ?, booker_name = ?, display_name = ?,
           note = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(v.checkInDate, v.checkOutDate, v.channel, v.bookerName || null, v.bookerName || null, v.note || null, now, id),
    auditStatement(db, actor, "update_reservation", id),
  ]);
  return c.json({ ok: true });
});

/** 手動登録・テスト予約の削除。宿泊者の登録が始まっていたら削除できない */
reservationRoutes.delete("/reservations/:id", async (c) => {
  const id = c.req.param("id");
  const row = await loadDetail(c, id);
  if (!row) return c.json(notFound(), 404);
  if (row.source !== "manual") return c.json(badRequest("取り込んだ予約は削除できません（ブロックに変更してください）"), 400);
  if (row.reg_status !== "none") return c.json(badRequest("宿泊者の登録が始まっているため削除できません"), 400);
  const db = c.var.db;
  await db.batch([
    db.prepare("DELETE FROM reservations WHERE id = ? AND reg_status = 'none'").bind(id),
    auditStatement(db, `admin:${c.var.admin.email}`, "delete_reservation", id),
  ]);
  return c.json({ ok: true });
});

/** 宿泊者入力画面の URL の作り直し（古い URL は無効になる。要件定義書 G-03） */
reservationRoutes.post("/reservations/:id/token", async (c) => {
  const id = c.req.param("id");
  const db = c.var.db;
  const result = await db.batch([
    db.prepare("UPDATE reservations SET guest_token = ?, invite_sent_at = NULL, updated_at = ? WHERE id = ?").bind(randomToken(), nowIso(), id),
    auditStatement(db, `admin:${c.var.admin.email}`, "regenerate_guest_token", id),
  ]);
  if ((result[0].meta.changes ?? 0) === 0) return c.json(notFound(), 404);
  return c.json({ ok: true });
});
