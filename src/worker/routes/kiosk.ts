import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { addDays, formatDateJa, jstNow } from "../../shared/dates";
import { LANGS, type Lang } from "../../shared/langs";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { randomToken, sha256Base64Url } from "../lib/crypto";
import { getSettings, getText, PROPERTY_ID } from "../lib/settings";
import { DAY_MS, nowIso } from "../lib/time";
import { readAdminSession } from "../middleware/admin";
import { countersStatement, type ReservationRow } from "../services/guests";
import { notifyHost } from "../services/notify";
import { detectImageType, MAX_PHOTO_BYTES, saveKioskPhoto } from "../services/photos";

/** 玄関タブレットの API（設計書 4.6、5.2） */

const KIOSK_COOKIE = "th_kiosk";

type KioskEnv = AppEnv & { Variables: AppEnv["Variables"] & { kioskActor: string; testMode: boolean } };

interface DeviceCache {
  deviceId: string;
  expires: number;
}
/** 端末の確認は 5 分間メモリに覚えておき、毎回 D1 を読まない（設計書 DB-04） */
const deviceCache = new Map<string, DeviceCache>();

/** 登録を取り消したときに呼ぶ（同じ Worker では即座に使えなくなる。他の Worker では最大 5 分残る） */
export function forgetDevice(deviceId: string): void {
  for (const [hash, cached] of deviceCache) if (cached.deviceId === deviceId) deviceCache.delete(hash);
}

function forbidden(c: Context<KioskEnv>) {
  return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
}

/**
 * 認証。通常は登録済みの端末の Cookie。X-Kiosk-Mode: test のときは、登録していない端末でも
 * 管理者のログインで開ける（表示する予約は同じ。要件定義書 H-32）
 */
const kioskAuth: MiddlewareHandler<KioskEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.header("Origin") !== new URL(c.req.url).origin) return forbidden(c);

  if (c.req.header("X-Kiosk-Mode") === "test") {
    // 宿泊者の氏名を表示するため、施設管理者だけ
    const admin = await readAdminSession(c as unknown as Context<AppEnv>, "facility");
    if (!admin) return c.json({ error: { code: "unauthorized", message: "unauthorized" } }, 401);
    c.set("kioskActor", `admin:${admin.email}`);
    c.set("testMode", true);
    return next();
  }

  const token = getCookie(c, KIOSK_COOKIE);
  if (!token) return c.json({ error: { code: "not_paired", message: "not_paired" } }, 401);
  const hash = await sha256Base64Url(token);
  const now = Date.now();
  let cached = deviceCache.get(hash);
  if (!cached || cached.expires < now) {
    const db = c.var.db;
    const device = await db.first<{ id: string; last_seen_at: string | null; revoked_at: string | null }>(
      db.prepare("SELECT id, last_seen_at, revoked_at FROM devices WHERE token_hash = ?").bind(hash),
    );
    if (!device || device.revoked_at) {
      deviceCache.delete(hash);
      return c.json({ error: { code: "not_paired", message: "not_paired" } }, 401);
    }
    // 最終利用日時の更新は 1 日 1 回まで
    if (!device.last_seen_at || now - Date.parse(device.last_seen_at) > DAY_MS) {
      await db.run(db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(nowIso(), device.id));
    }
    cached = { deviceId: device.id, expires: now + 5 * 60 * 1000 };
    deviceCache.set(hash, cached);
  }
  c.set("kioskActor", `kiosk:${cached.deviceId}`);
  c.set("testMode", false);
  await next();
};

export const kioskRoutes = new Hono<KioskEnv>();

/** 端末の登録（管理画面で発行した 8 桁のコード。10 分で失効） */
kioskRoutes.post("/pair", async (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return forbidden(c);
  const parsed = z.object({ code: z.string().regex(/^\d{8}$/) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: { code: "invalid_code", message: "invalid_code" } }, 400);
  const db = c.var.db;
  const pairing = await db.first<{ code: string; name: string }>(
    db.prepare("SELECT code, name FROM device_pairings WHERE code = ? AND expires_at > ?").bind(parsed.data.code, nowIso()),
  );
  if (!pairing) return c.json({ error: { code: "invalid_code", message: "invalid_code" } }, 400);

  const token = randomToken(32);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO devices (id, property_id, name, token_hash, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, PROPERTY_ID, pairing.name, await sha256Base64Url(token), now, now),
    db.prepare("DELETE FROM device_pairings WHERE code = ?").bind(pairing.code),
    auditStatement(db, `kiosk:${id}`, "pair_device", pairing.name),
  ]);
  setCookie(c, KIOSK_COOKIE, token, { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: 365 * 24 * 60 * 60 });
  return c.json({ ok: true });
});

kioskRoutes.use("*", kioskAuth);

/** 画面の表示に必要な情報（施設名、連絡方法） */
kioskRoutes.get("/status", async (c) => {
  const settings = await getSettings(c.var.db);
  return c.json({
    propertyName: settings.property.name,
    testMode: c.var.testMode,
    hostContact: Object.fromEntries(LANGS.map((l) => [l, getText(settings, "host_contact", l)])) as Record<Lang, string>,
  });
});

interface CheckinRow {
  reservation_id: string;
  is_test: number;
  guest_id: string;
  seq: number;
  full_name: string | null;
  checked_in_at: string | null;
}

/**
 * チェックインの一覧の条件（要件定義書 T-02、T-09）。索引 idx_reservations_checkout で当日前後の予約だけを調べる。
 * テスト予約も本番の予約と同じように表示する（画面では「テスト」と添えて見分けられるようにする）
 */
function checkinListStatement(c: Context<KioskEnv>) {
  const today = jstNow().date;
  return c.var.db
    .prepare(
      `SELECT r.id AS reservation_id, r.is_test, g.id AS guest_id, g.seq, g.full_name, g.checked_in_at
       FROM reservations r JOIN guests g ON g.reservation_id = r.id
       WHERE r.check_out_date >= ?1 AND r.check_in_date <= ?1 AND r.status = 'confirmed' AND r.stay_status <> 'checked_out'
         AND g.status = 'approved'
       ORDER BY r.check_in_date, g.seq LIMIT 60`,
    )
    .bind(today);
}

kioskRoutes.get("/checkin", async (c) => {
  const rows = await c.var.db.all<CheckinRow>(checkinListStatement(c));
  return c.json({
    guests: rows.map((r) => ({
      guestId: r.guest_id,
      name: r.full_name ?? "",
      done: r.checked_in_at !== null,
      isTest: r.is_test === 1,
    })),
  });
});

/** 当日の写真の保存とチェックイン（撮影済みの人は撮り直せない。要件定義書 S-09） */
kioskRoutes.post("/guests/:id/photo", async (c) => {
  const guestId = c.req.param("id");
  const db = c.var.db;
  const rows = await db.all<CheckinRow>(checkinListStatement(c));
  const target = rows.find((r) => r.guest_id === guestId);
  if (!target || target.checked_in_at) return forbidden(c);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > MAX_PHOTO_BYTES) return c.json({ error: { code: "bad_request", message: "bad_request" } }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageType(bytes);
  if (!mime) return c.json({ error: { code: "bad_request", message: "not_image" } }, 400);

  const reservation = await db.first<ReservationRow>(db.prepare("SELECT * FROM reservations WHERE id = ?").bind(target.reservation_id));
  if (!reservation) return forbidden(c);

  let saved;
  try {
    saved = await saveKioskPhoto(c.env, db, reservation, { id: guestId, seq: target.seq, full_name: target.full_name }, bytes, mime);
  } catch (e) {
    console.error(JSON.stringify({ event: "kiosk_photo_failed", message: String(e) }));
    return c.json({ error: { code: "upload_failed", message: "upload_failed" } }, 502);
  }

  const now = nowIso();
  const first = reservation.stay_status === "not_arrived";
  await db.batch([
    ...saved.statements,
    db
      .prepare("UPDATE guests SET kiosk_photo_id = ?, checked_in_at = ?, updated_at = ? WHERE id = ? AND checked_in_at IS NULL")
      .bind(saved.photoId, now, now, guestId),
    // 後から来た人がいれば、照合をやり直してもらう（設計書 4.7）
    db
      .prepare(
        `UPDATE reservations SET stay_status = 'in_house', first_checkin_at = COALESCE(first_checkin_at, ?),
           photos_verified_at = NULL WHERE id = ?`,
      )
      .bind(now, reservation.id),
    countersStatement(db, reservation.id, now),
    auditStatement(db, c.var.kioskActor, "kiosk_checkin", guestId),
  ]);

  const approved = rows.filter((r) => r.reservation_id === reservation.id);
  const checkedIn = approved.filter((r) => r.checked_in_at || r.guest_id === guestId).length;
  const allDone = checkedIn === approved.length;
  if (first || allDone) {
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(
      notifyHost(c.env, db, {
        isTest: reservation.is_test === 1,
        subject: allDone ? "全員がチェックインしました（写真の照合をお願いします）" : "チェックインが始まりました",
        text: [
          `宿泊日: ${formatDateJa(reservation.check_in_date)} 〜 ${formatDateJa(reservation.check_out_date)}`,
          `チェックイン: ${checkedIn} / ${approved.length}人`,
          "",
          `確認: ${origin}/admin/reservations/${reservation.id}`,
        ].join("\n"),
      }),
    );
  }
  return c.json({ ok: true, allDone });
});

function checkoutListStatement(c: Context<KioskEnv>) {
  const today = jstNow().date;
  // 予定より早いチェックアウト、予定日を過ぎたチェックアウトの両方に対応する
  return c.var.db
    .prepare(
      `SELECT id, display_name, is_test FROM reservations
       WHERE check_out_date >= ? AND check_in_date <= ? AND stay_status = 'in_house'
       ORDER BY check_in_date LIMIT 10`,
    )
    .bind(addDays(today, -3), today);
}

kioskRoutes.get("/checkout", async (c) => {
  const rows = await c.var.db.all<{ id: string; display_name: string | null; is_test: number }>(checkoutListStatement(c));
  return c.json({
    reservations: rows.map((r) => ({ reservationId: r.id, name: r.display_name ?? "", isTest: r.is_test === 1 })),
  });
});

kioskRoutes.post("/reservations/:id/checkout", async (c) => {
  const id = c.req.param("id");
  const db = c.var.db;
  const rows = await db.all<{ id: string }>(checkoutListStatement(c));
  if (!rows.some((r) => r.id === id)) return forbidden(c);
  const now = nowIso();
  await db.batch([
    db
      .prepare("UPDATE reservations SET stay_status = 'checked_out', checked_out_at = ?, checked_out_by = 'kiosk' WHERE id = ? AND stay_status = 'in_house'")
      .bind(now, id),
    auditStatement(db, c.var.kioskActor, "kiosk_checkout", id),
  ]);
  const r = await db.first<ReservationRow>(db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id));
  if (r) {
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(
      notifyHost(c.env, db, {
        isTest: r.is_test === 1,
        subject: "チェックアウトしました（清掃を始められます）",
        text: [
          `宿泊日: ${formatDateJa(r.check_in_date)} 〜 ${formatDateJa(r.check_out_date)}`,
          "",
          "清掃のときに、キーボックスの暗証番号を次の予約用に変えてください。",
          `確認: ${origin}/admin/reservations/${r.id}`,
        ].join("\n"),
      }),
    );
  }
  return c.json({ ok: true });
});
