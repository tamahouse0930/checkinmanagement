import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { getSettings, invalidateSettings, PROPERTY_ID } from "../lib/settings";
import { nowIso } from "../lib/time";
import { requireFacility } from "../middleware/admin";
import { sendMail } from "../services/google/gmail";
import { loadSetupStatus } from "../services/setup";
import { forgetDevice } from "./kiosk";
import { adminGuestRoutes } from "./admin-guests";
import { ledgerRoutes } from "./ledger";
import { reservationRoutes } from "./reservations";
import { LANGS } from "../../shared/langs";
import { DEFAULT_TEXTS, TEXT_KINDS, textMaxLength, type TextKind } from "../../shared/templates";
import { DEFAULT_PRIVACY } from "../../shared/privacy";

/** 施設管理者の API（予約・名簿・写真・設定。設計書 7.1） */
export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireFacility);
adminRoutes.route("/", reservationRoutes);
adminRoutes.route("/", adminGuestRoutes);
adminRoutes.route("/", ledgerRoutes);

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

const emailSchema = z.email().transform((v) => v.toLowerCase());

// ---- 通知メールの宛先 ----

adminRoutes.get("/recipients", async (c) => {
  const db = c.var.db;
  const rows = await db.all(db.prepare("SELECT email, name, created_at FROM notify_recipients ORDER BY created_at LIMIT 50"));
  return c.json({ recipients: rows });
});

adminRoutes.post("/recipients", async (c) => {
  const parsed = z.object({ email: emailSchema, name: z.string().trim().max(50).optional() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("メールアドレスを確認してください"), 400);
  const db = c.var.db;
  await db.run(
    db
      .prepare("INSERT INTO notify_recipients (email, name, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET name = excluded.name")
      .bind(parsed.data.email, parsed.data.name || null, nowIso()),
  );
  invalidateSettings();
  return c.json({ ok: true });
});

adminRoutes.delete("/recipients/:email", async (c) => {
  const db = c.var.db;
  await db.run(db.prepare("DELETE FROM notify_recipients WHERE email = ?").bind(c.req.param("email").toLowerCase()));
  invalidateSettings();
  return c.json({ ok: true });
});

// ---- 設定 ----

/** 初期設定の各項目が済んでいるか（設計書 4.14） */
adminRoutes.get("/setup", async (c) => {
  return c.json((await loadSetupStatus(c.var.db)).status);
});

adminRoutes.get("/settings", async (c) => {
  const { property, googleLink } = await getSettings(c.var.db);
  return c.json({
    property: {
      name: property.name,
      checkinTime: property.checkin_time,
      checkoutTime: property.checkout_time,
      operatorName: property.operator_name,
      operatorContact: property.operator_contact,
    },
    google: {
      serviceEmail: c.env.GOOGLE_SERVICE_EMAIL,
      linked: googleLink !== null,
      accountEmail: googleLink?.account_email ?? null,
      linkedAt: googleLink?.linked_at ?? null,
      lastError: googleLink?.last_error ?? null,
      driveFolderReady: property.drive_root_folder_id !== null,
    },
  });
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

adminRoutes.put("/settings", async (c) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(50),
      checkinTime: timeSchema,
      checkoutTime: timeSchema,
      operatorName: z.string().trim().max(100),
      operatorContact: z.string().trim().max(200),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("入力内容を確認してください"), 400);
  const s = parsed.data;
  const db = c.var.db;
  await db.batch([
    db
      .prepare(
        `UPDATE properties SET name = ?, checkin_time = ?, checkout_time = ?, operator_name = ?, operator_contact = ?,
           settings_version = settings_version + 1, updated_at = ? WHERE id = ?`,
      )
      .bind(s.name, s.checkinTime, s.checkoutTime, s.operatorName, s.operatorContact, nowIso(), PROPERTY_ID),
    auditStatement(db, `admin:${c.var.admin.email}`, "update_settings"),
  ]);
  invalidateSettings();
  return c.json({ ok: true });
});

// ---- 玄関タブレット（要件定義書 T-10、設計書 4.6） ----

adminRoutes.get("/devices", async (c) => {
  const db = c.var.db;
  const rows = await db.all(
    db.prepare("SELECT id, name, last_seen_at, created_at FROM devices WHERE revoked_at IS NULL ORDER BY created_at LIMIT 20"),
  );
  return c.json({ devices: rows });
});

/** 登録用のコード（8 桁、10 分で失効）。タブレットの画面で入力してもらう */
adminRoutes.post("/devices/pairing", async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(50) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("タブレットの名前を入力してください"), 400);
  const db = c.var.db;
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
  const code = String(n).padStart(8, "0");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM device_pairings WHERE expires_at < ?").bind(nowIso()),
    db
      .prepare("INSERT INTO device_pairings (code, property_id, name, expires_at) VALUES (?, ?, ?, ?)")
      .bind(code, PROPERTY_ID, parsed.data.name, expiresAt),
    auditStatement(db, `admin:${c.var.admin.email}`, "create_device_pairing", parsed.data.name),
  ]);
  return c.json({ code, expiresAt });
});

adminRoutes.delete("/devices/:id", async (c) => {
  const db = c.var.db;
  await db.batch([
    db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").bind(nowIso(), c.req.param("id")),
    auditStatement(db, `admin:${c.var.admin.email}`, "revoke_device", c.req.param("id")),
  ]);
  forgetDevice(c.req.param("id"));
  return c.json({ ok: true });
});

// ---- 文面（案内文・ハウスルールなど。言語ごと） ----

adminRoutes.get("/texts", async (c) => {
  const { texts } = await getSettings(c.var.db);
  return c.json({ texts: Object.fromEntries(texts), defaults: { ...DEFAULT_TEXTS, privacy: DEFAULT_PRIVACY } });
});

adminRoutes.put("/texts", async (c) => {
  const parsed = z
    .object({ kind: z.enum(TEXT_KINDS as [TextKind, ...TextKind[]]), lang: z.enum(LANGS), body: z.string().max(10000) })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("入力内容を確認してください"), 400);
  const { kind, lang, body } = parsed.data;
  if (body.length > textMaxLength(kind)) return c.json(badRequest(`${textMaxLength(kind)} 文字までにしてください`), 400);
  const db = c.var.db;
  // 空にしたら既定の文面に戻す（行を消す）
  await db.batch([
    body.trim()
      ? db
          .prepare(
            "INSERT INTO property_texts (property_id, kind, lang, body) VALUES (?, ?, ?, ?) ON CONFLICT (property_id, kind, lang) DO UPDATE SET body = excluded.body",
          )
          .bind(PROPERTY_ID, kind, lang, body.trim())
      : db.prepare("DELETE FROM property_texts WHERE property_id = ? AND kind = ? AND lang = ?").bind(PROPERTY_ID, kind, lang),
    auditStatement(db, `admin:${c.var.admin.email}`, "update_text", `${kind}:${lang}`),
  ]);
  invalidateSettings();
  return c.json({ ok: true });
});

// ---- iCal の取得元（要件定義書 R-01） ----

const icalSchema = z.object({
  channel: z.enum(["airbnb", "booking"]),
  url: z.url({ protocol: /^https$/ }).max(1000),
});

adminRoutes.get("/ical-sources", async (c) => {
  const db = c.var.db;
  const rows = await db.all(db.prepare("SELECT id, channel, url, last_synced_at, last_error FROM ical_sources LIMIT 10"));
  return c.json({ sources: rows });
});

adminRoutes.post("/ical-sources", async (c) => {
  const parsed = icalSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("https で始まる iCal の URL を入力してください"), 400);
  const db = c.var.db;
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO ical_sources (id, property_id, channel, url) VALUES (?, ?, ?, ?)")
      .bind(id, PROPERTY_ID, parsed.data.channel, parsed.data.url),
    auditStatement(db, `admin:${c.var.admin.email}`, "add_ical_source", parsed.data.channel),
  ]);
  return c.json({ id }, 201);
});

adminRoutes.put("/ical-sources/:id", async (c) => {
  const parsed = icalSchema.pick({ url: true }).safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("https で始まる iCal の URL を入力してください"), 400);
  const db = c.var.db;
  await db.batch([
    db.prepare("UPDATE ical_sources SET url = ?, last_error = NULL WHERE id = ?").bind(parsed.data.url, c.req.param("id")),
    auditStatement(db, `admin:${c.var.admin.email}`, "update_ical_source", c.req.param("id")),
  ]);
  return c.json({ ok: true });
});

adminRoutes.delete("/ical-sources/:id", async (c) => {
  const db = c.var.db;
  try {
    await db.batch([
      db.prepare("DELETE FROM ical_sources WHERE id = ?").bind(c.req.param("id")),
      auditStatement(db, `admin:${c.var.admin.email}`, "delete_ical_source", c.req.param("id")),
    ]);
  } catch {
    // 取り込んだ予約が残っている取得元は、外部キーの制約で削除できない
    return c.json(badRequest("この取得元から取り込んだ予約があるため削除できません。URL の変更で対応してください"), 400);
  }
  return c.json({ ok: true });
});

/** 連携の確認用: 登録した宛先にテストメールを送る */
adminRoutes.post("/google/test-mail", async (c) => {
  const db = c.var.db;
  const { recipients, property } = await getSettings(db);
  if (recipients.length === 0) return c.json(badRequest("通知メールの宛先を登録してください"), 400);
  try {
    await sendMail(c.env, db, {
      to: recipients,
      subject: `[テスト] [${property.name}] 通知メールのテスト`,
      text: `管理画面から送信したテストメールです。\n送信者: ${c.var.admin.email}`,
    });
  } catch (error) {
    return c.json({ error: { code: "mail_failed", message: String(error instanceof Error ? error.message : error) } }, 502);
  }
  return c.json({ ok: true });
});
