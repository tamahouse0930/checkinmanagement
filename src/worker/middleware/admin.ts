import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { decodeSession, encodeSession, needsRenewal, SESSION_COOKIE, SESSION_TTL_MS, type SessionPayload } from "../lib/session";
import { type AdminRoles, getSettings } from "../lib/settings";

/** ログイン中の管理者。権限は Cookie に入れず、毎回 admin_accounts（設定のキャッシュ）から引く */
export type AdminSession = SessionPayload & { roles: AdminRoles };

export function setSessionCookie(c: Context<AppEnv>, value: string): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * Cookie を検証して、ログイン中の管理者と権限を返す（D1 は設定のキャッシュ以外読まない）。
 * role を指定したときは、その権限がなければ null
 */
export async function readAdminSession(c: Context<AppEnv>, role?: keyof AdminRoles): Promise<AdminSession | null> {
  const payload = await decodeSession(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE));
  if (!payload) return null;
  const settings = await getSettings(c.var.db);
  const roles = settings.accounts.get(payload.email);
  if (!roles || settings.revokedSids.has(payload.sid)) return null;
  if (role && !roles[role]) return null;
  return { ...payload, roles };
}

/**
 * 管理画面の API の認証（設計書 7.1）。role を指定しなければ、どちらかの権限があればよい
 * （ログイン中の端末、システムの状態など、両方の画面で使う API）
 */
function requireRole(role?: keyof AdminRoles): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // 更新系の API は、自分のドメインから呼ばれたことを確認する（CSRF 対策）
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("Origin");
      if (origin !== new URL(c.req.url).origin) {
        return c.json({ error: { code: "forbidden", message: "不正なリクエストです" } }, 403);
      }
    }

    const admin = await readAdminSession(c);
    if (!admin) {
      return c.json({ error: { code: "unauthorized", message: "ログインしてください" } }, 401);
    }
    if (role && !admin.roles[role]) {
      return c.json({ error: { code: "forbidden", message: "この操作の権限がありません" } }, 403);
    }

    // 最後の発行から 1 日以上たっていたら、有効期限を 30 日に延ばす（D1 への書き込みは 1 日 1 回まで）
    if (needsRenewal(admin)) {
      const now = Date.now();
      const { roles, ...payload } = admin;
      const renewed: SessionPayload = { ...payload, iat: now, exp: now + SESSION_TTL_MS };
      setSessionCookie(c, await encodeSession(c.env.SESSION_SECRET, renewed));
      await c.var.db.run(
        c.var.db
          .prepare("UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
          .bind(new Date(now).toISOString(), new Date(renewed.exp).toISOString(), admin.sid),
      );
      c.set("admin", { ...renewed, roles });
    } else {
      c.set("admin", admin);
    }
    await next();
  };
}

/** どちらかの権限があればよい */
export const requireLogin = requireRole();
/** 施設管理者（予約・名簿・写真・設定） */
export const requireFacility = requireRole("facility");
/** システム管理者（施設管理者の登録、操作ログ） */
export const requireSystem = requireRole("system");
