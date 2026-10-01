import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { SystemStatus } from "../../shared/api-types";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { SESSION_COOKIE } from "../lib/session";
import { getSettings, invalidateSettings, parseRevoked, PROPERTY_ID, type RevokedSession } from "../lib/settings";
import { nowIso } from "../lib/time";
import { requireLogin } from "../middleware/admin";

/**
 * システム管理者・施設管理者のどちらでも使う API（設計書 7.1）。
 * ログイン中の管理者の情報、ログアウト、ログイン中の端末、システムの状態。宿泊者の個人情報は返さない
 */
export const accountRoutes = new Hono<AppEnv>();
accountRoutes.use("*", requireLogin);

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

accountRoutes.get("/me", async (c) => {
  const { property } = await getSettings(c.var.db);
  const { email, roles } = c.var.admin;
  return c.json({ email, roles, serviceEmail: c.env.GOOGLE_SERVICE_EMAIL, propertyName: property.name });
});

accountRoutes.post("/logout", async (c) => {
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

accountRoutes.get("/sessions", async (c) => {
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

accountRoutes.delete("/sessions/:id", async (c) => {
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

// ---- システムの状態 ----

/** 障害に気付くための情報（定期処理、Google 連携、予約の取り込み、タブレット）。宿泊者の個人情報は含めない */
accountRoutes.get("/status", async (c) => {
  const db = c.var.db;
  const [jobs, sources, devices] = await db.batch([
    db.prepare("SELECT job, MAX(run_date) AS last_run FROM job_runs GROUP BY job"),
    db.prepare("SELECT channel, last_synced_at, last_error FROM ical_sources ORDER BY channel LIMIT 10"),
    db.prepare("SELECT name, last_seen_at FROM devices WHERE revoked_at IS NULL ORDER BY created_at LIMIT 20"),
  ]);
  const { googleLink, property } = await getSettings(db);
  const body: SystemStatus = {
    jobs: jobs.results as SystemStatus["jobs"],
    google: {
      linked: googleLink !== null,
      accountEmail: googleLink?.account_email ?? null,
      linkedAt: googleLink?.linked_at ?? null,
      lastError: googleLink?.last_error ?? null,
    },
    icalSources: sources.results as SystemStatus["icalSources"],
    devices: devices.results as SystemStatus["devices"],
    missingPhotoCount: property.missing_photo_count,
  };
  return c.json(body);
});
