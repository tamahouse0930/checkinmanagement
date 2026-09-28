import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { decodeSession, encodeSession, needsRenewal, SESSION_COOKIE, SESSION_TTL_MS, type SessionPayload } from "../lib/session";
import { getSettings } from "../lib/settings";

export function setSessionCookie(c: Context<AppEnv>, value: string): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Cookie を検証して、ログイン中の管理者を返す（D1 は設定のキャッシュ以外読まない） */
export async function readAdminSession(c: Context<AppEnv>): Promise<SessionPayload | null> {
  const payload = await decodeSession(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE));
  if (!payload) return null;
  const settings = await getSettings(c.var.db);
  if (!settings.adminEmails.has(payload.email)) return null;
  if (settings.revokedSids.has(payload.sid)) return null;
  return payload;
}

/** 管理画面の API の認証（設計書 7.1） */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  // 更新系の API は、自分のドメインから呼ばれたことを確認する（CSRF 対策）
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin !== new URL(c.req.url).origin) {
      return c.json({ error: { code: "forbidden", message: "不正なリクエストです" } }, 403);
    }
  }

  const payload = await readAdminSession(c);
  if (!payload) {
    return c.json({ error: { code: "unauthorized", message: "ログインしてください" } }, 401);
  }

  // 最後の発行から 1 日以上たっていたら、有効期限を 30 日に延ばす（D1 への書き込みは 1 日 1 回まで）
  if (needsRenewal(payload)) {
    const now = Date.now();
    const renewed: SessionPayload = { ...payload, iat: now, exp: now + SESSION_TTL_MS };
    setSessionCookie(c, await encodeSession(c.env.SESSION_SECRET, renewed));
    await c.var.db.run(
      c.var.db
        .prepare("UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
        .bind(new Date(now).toISOString(), new Date(renewed.exp).toISOString(), payload.sid),
    );
    c.set("admin", renewed);
  } else {
    c.set("admin", payload);
  }
  await next();
};
