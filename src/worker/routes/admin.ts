import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { SESSION_COOKIE } from "../lib/session";
import { getSettings, invalidateSettings, parseRevoked, PROPERTY_ID, type RevokedSession } from "../lib/settings";
import { nowIso } from "../lib/time";
import { requireAdmin } from "../middleware/admin";
import { sendMail } from "../services/google/gmail";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAdmin);

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

const emailSchema = z.email().transform((v) => v.toLowerCase());

/**
 * セッションを取り消す。取り消したセッション ID は設定の行に持ち、キャッシュと照合する（設計書 7.1）。
 * 有効期限を過ぎたものはここで取り除く。
 */
function revokeStatement(c: { var: AppEnv["Variables"] }, current: string, add: RevokedSession) {
  const now = Date.now();
  const list = parseRevoked(current).filter((r) => r.exp > now && r.sid !== add.sid);
  list.push(add);
  return c.var.db
    .prepare("UPDATE properties SET revoked_sessions = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(list), nowIso(), PROPERTY_ID);
}

adminRoutes.get("/me", (c) => {
  return c.json({ email: c.var.admin.email, serviceEmail: c.env.GOOGLE_SERVICE_EMAIL });
});

adminRoutes.post("/logout", async (c) => {
  const db = c.var.db;
  const { property } = await getSettings(db);
  const admin = c.var.admin;
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(admin.sid),
    revokeStatement(c, property.revoked_sessions, { sid: admin.sid, exp: admin.exp }),
  ]);
  invalidateSettings();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---- ログイン中の端末 ----

adminRoutes.get("/sessions", async (c) => {
  const db = c.var.db;
  const rows = await db.all<{ id: string; email: string; user_agent: string | null; created_at: string; last_seen_at: string }>(
    db
      .prepare(
        "SELECT id, email, user_agent, created_at, last_seen_at FROM admin_sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 50",
      )
      .bind(nowIso()),
  );
  return c.json({ sessions: rows.map((r) => ({ ...r, current: r.id === c.var.admin.sid })) });
});

adminRoutes.delete("/sessions/:id", async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const [{ property }, row] = await Promise.all([
    getSettings(db),
    db.first<{ expires_at: string }>(db.prepare("SELECT expires_at FROM admin_sessions WHERE id = ?").bind(id)),
  ]);
  if (!row) return c.json({ error: { code: "not_found", message: "端末が見つかりません" } }, 404);
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(id),
    revokeStatement(c, property.revoked_sessions, { sid: id, exp: Date.parse(row.expires_at) }),
    auditStatement(db, `admin:${c.var.admin.email}`, "revoke_session", id),
  ]);
  invalidateSettings();
  return c.json({ ok: true });
});

// ---- ログインできるアカウント ----

adminRoutes.get("/accounts", async (c) => {
  const db = c.var.db;
  const rows = await db.all(db.prepare("SELECT email, name, created_at FROM admin_accounts ORDER BY created_at LIMIT 50"));
  return c.json({ accounts: rows });
});

adminRoutes.post("/accounts", async (c) => {
  const parsed = z.object({ email: emailSchema, name: z.string().trim().max(50).optional() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("メールアドレスを確認してください"), 400);
  const db = c.var.db;
  await db.batch([
    db
      .prepare("INSERT INTO admin_accounts (email, name, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET name = excluded.name")
      .bind(parsed.data.email, parsed.data.name || null, nowIso()),
    auditStatement(db, `admin:${c.var.admin.email}`, "add_admin_account", parsed.data.email),
  ]);
  invalidateSettings();
  return c.json({ ok: true });
});

adminRoutes.delete("/accounts/:email", async (c) => {
  const email = c.req.param("email").toLowerCase();
  const db = c.var.db;
  const { adminEmails } = await getSettings(db);
  if (!adminEmails.has(email)) return c.json({ error: { code: "not_found", message: "アカウントが見つかりません" } }, 404);
  // 最後の 1 件は削除できない（全員がログインできなくなるのを防ぐ）
  if (adminEmails.size <= 1) return c.json(badRequest("最後のアカウントは削除できません"), 400);
  await db.batch([
    db.prepare("DELETE FROM admin_accounts WHERE email = ?").bind(email),
    auditStatement(db, `admin:${c.var.admin.email}`, "delete_admin_account", email),
  ]);
  invalidateSettings();
  return c.json({ ok: true });
});

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

/** 連携の確認用: 登録した宛先にテストメールを送る */
adminRoutes.post("/google/test-mail", async (c) => {
  const db = c.var.db;
  const { recipients } = await getSettings(db);
  if (recipients.length === 0) return c.json(badRequest("通知メールの宛先を登録してください"), 400);
  try {
    await sendMail(c.env, db, {
      to: recipients,
      subject: "[テスト] [TAMAHOUSE] 通知メールのテスト",
      text: `管理画面から送信したテストメールです。\n送信者: ${c.var.admin.email}`,
    });
  } catch (error) {
    return c.json({ error: { code: "mail_failed", message: String(error instanceof Error ? error.message : error) } }, 502);
  }
  return c.json({ ok: true });
});
