import { Hono } from "hono";
import { z } from "zod";
import type { AuditLogRow } from "../../shared/api-types";
import { setupLabel } from "../../shared/setup";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { facilityEmails, getSettings, invalidateSettings } from "../lib/settings";
import { nowIso } from "../lib/time";
import { requireSystem } from "../middleware/admin";
import { sendMail } from "../services/google/gmail";
import { loadSetupStatus } from "../services/setup";

/**
 * システム管理者の API（設計書 4.15）。施設管理者の登録・案内メールと、操作ログの閲覧。
 * 宿泊者の名簿・写真・予約は扱わない（それらは施設管理者の権限）
 */
export const systemRoutes = new Hono<AppEnv>();
systemRoutes.use("*", requireSystem);

function badRequest(message: string) {
  return { error: { code: "bad_request", message } };
}

const emailSchema = z.email().transform((v) => v.toLowerCase());

// ---- 施設管理者 ----

systemRoutes.get("/accounts", async (c) => {
  const db = c.var.db;
  const rows = await db.all(
    db.prepare("SELECT email, name, created_at, is_system FROM admin_accounts WHERE is_facility = 1 ORDER BY created_at LIMIT 50"),
  );
  return c.json({ accounts: rows });
});

/** 施設管理者として登録する。システム管理者のアカウントなら、施設管理者の権限を足す */
systemRoutes.post("/accounts", async (c) => {
  const parsed = z.object({ email: emailSchema, name: z.string().trim().max(50).optional() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json(badRequest("メールアドレスを確認してください"), 400);
  const db = c.var.db;
  await db.batch([
    db
      .prepare(
        `INSERT INTO admin_accounts (email, name, created_at, is_system, is_facility) VALUES (?, ?, ?, 0, 1)
         ON CONFLICT (email) DO UPDATE SET name = COALESCE(excluded.name, admin_accounts.name), is_facility = 1`,
      )
      .bind(parsed.data.email, parsed.data.name || null, nowIso()),
    auditStatement(db, `admin:${c.var.admin.email}`, "add_admin_account", parsed.data.email),
  ]);
  invalidateSettings();
  return c.json({ ok: true });
});

/** 施設管理者から外す。システム管理者も兼ねるアカウントは、施設管理者の権限だけを外す */
systemRoutes.delete("/accounts/:email", async (c) => {
  const email = c.req.param("email").toLowerCase();
  const db = c.var.db;
  const settings = await getSettings(db);
  const roles = settings.accounts.get(email);
  if (!roles?.facility) return c.json({ error: { code: "not_found", message: "アカウントが見つかりません" } }, 404);
  // 施設管理者が 1 人もいなくなると、予約や名簿を扱える人がいなくなるため、最後の 1 人は外せない
  if (facilityEmails(settings).length <= 1) return c.json(badRequest("最後の施設管理者は削除できません"), 400);
  await db.batch([
    roles.system
      ? db.prepare("UPDATE admin_accounts SET is_facility = 0 WHERE email = ?").bind(email)
      : db.prepare("DELETE FROM admin_accounts WHERE email = ?").bind(email),
    auditStatement(db, `admin:${c.var.admin.email}`, "delete_admin_account", email),
  ]);
  invalidateSettings();
  return c.json({ ok: true });
});

/**
 * 初期設定の案内メール（設計書 4.14）。施設管理者に、管理画面の URL とログインに使う Google アカウント、
 * まだ済んでいない初期設定の項目を知らせる。メールは施設が連携した Gmail から送る
 */
systemRoutes.post("/accounts/:email/invite", async (c) => {
  const email = c.req.param("email").toLowerCase();
  const db = c.var.db;
  const { settings, status } = await loadSetupStatus(db);
  if (!settings.accounts.get(email)?.facility) {
    return c.json({ error: { code: "not_found", message: "アカウントが見つかりません" } }, 404);
  }
  if (!settings.googleLinks.mail) {
    return c.json(badRequest("施設が通知メールの送信用の Google アカウントと連携してから送ってください（メールはそのアカウントから送ります）"), 400);
  }

  const { pending } = status;
  const name = settings.property.name;
  const url = `${new URL(c.req.url).origin}/admin/setup`;
  try {
    await sendMail(c.env, db, {
      to: [email],
      subject: `[${name}] 管理画面へのご案内（初期設定）`,
      text: [
        `${c.var.admin.email} さんが、${name} のチェックイン管理システムの管理者として、あなたを登録しました。`,
        "",
        "次の URL を開き、「Google でログイン」から、このメールを受け取った Google アカウントでログインしてください。",
        `ログインに使うアカウント: ${email}`,
        url,
        "",
        "ログインすると初期設定の画面が開きます。上から順に確認・設定してください。",
        pending.length > 0 ? `まだ済んでいない項目: ${pending.map(setupLabel).join("、")}` : "必要な初期設定はすべて済んでいます。",
        "",
        "心当たりがない場合は、このメールを破棄してください。",
      ].join("\n"),
    });
  } catch (error) {
    return c.json({ error: { code: "mail_failed", message: String(error instanceof Error ? error.message : error) } }, 502);
  }
  c.executionCtx.waitUntil(db.run(auditStatement(db, `admin:${c.var.admin.email}`, "send_admin_invite", email)));
  return c.json({ ok: true });
});

// ---- 操作ログ ----

const PAGE_SIZE = 50;

/**
 * 操作ログを新しい順に 50 件ずつ返す。続きは next（最後の行の日時と ID）を before・beforeId に渡す。
 * 索引 idx_audit_logs_created で読むため、読み取り行数は 1 回 51 行まで
 */
systemRoutes.get("/audit-logs", async (c) => {
  const before = c.req.query("before");
  const beforeId = c.req.query("beforeId") ?? "";
  if (before !== undefined && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before)) return c.json(badRequest("指定が不正です"), 400);
  const db = c.var.db;
  const rows = await db.all<AuditLogRow>(
    before
      ? db
          .prepare(
            `SELECT id, actor, action, target, created_at FROM audit_logs
             WHERE created_at < ?1 OR (created_at = ?1 AND id < ?2) ORDER BY created_at DESC, id DESC LIMIT ?3`,
          )
          .bind(before, beforeId, PAGE_SIZE + 1)
      : db
          .prepare("SELECT id, actor, action, target, created_at FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?")
          .bind(PAGE_SIZE + 1),
  );
  const logs = rows.slice(0, PAGE_SIZE);
  const last = logs[logs.length - 1];
  return c.json({ logs, next: rows.length > PAGE_SIZE && last ? { before: last.created_at, beforeId: last.id } : null });
});
