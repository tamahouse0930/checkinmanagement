import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { safeAdminPath } from "../../shared/setup";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { base64UrlDecode, base64UrlEncode, encryptText, randomToken, signValue, utf8Decode, utf8Encode, verifySignedValue } from "../lib/crypto";
import { encodeSession, newSessionPayload } from "../lib/session";
import { getSettings, invalidateSettings } from "../lib/settings";
import { nowIso } from "../lib/time";
import { readAdminSession, setSessionCookie } from "../middleware/admin";
import { ensureRootFolder } from "../services/google/drive";
import {
  buildAuthUrl,
  createPkce,
  exchangeCode,
  LINK_SCOPES,
  LOGIN_SCOPES,
  verifyIdTokenClaims,
} from "../services/google/oauth";
import { clearGoogleAccessToken } from "../services/google/token";
import { notifyHost } from "../services/notify";

type Mode = "login" | "link";

interface OAuthState {
  mode: Mode;
  state: string;
  nonce: string;
  verifier: string;
  /** ログイン後に戻る管理画面のパス（案内メールの URL から来た場合など） */
  next?: string;
}

const STATE_COOKIE = "th_oauth";

function redirectUri(c: Context<AppEnv>): string {
  return `${new URL(c.req.url).origin}/auth/google/callback`;
}

async function startFlow(c: Context<AppEnv>, mode: Mode): Promise<Response> {
  const pkce = await createPkce();
  const next = mode === "login" ? safeAdminPath(c.req.query("next")) : null;
  const flow: OAuthState = { mode, state: randomToken(), nonce: randomToken(), verifier: pkce.verifier, ...(next ? { next } : {}) };
  const signed = await signValue(c.env.SESSION_SECRET, base64UrlEncode(utf8Encode(JSON.stringify(flow))));
  // Google から戻ってくるときはサイトをまたぐ移動になるため SameSite=Lax にする
  setCookie(c, STATE_COOKIE, signed, { httpOnly: true, secure: true, sameSite: "Lax", path: "/auth", maxAge: 600 });

  return c.redirect(
    buildAuthUrl({
      clientId: c.env.GOOGLE_CLIENT_ID,
      redirectUri: redirectUri(c),
      scope: mode === "login" ? LOGIN_SCOPES : LINK_SCOPES,
      state: flow.state,
      nonce: flow.nonce,
      codeChallenge: pkce.challenge,
      offline: mode === "link",
      loginHint: mode === "link" ? c.env.GOOGLE_SERVICE_EMAIL : undefined,
    }),
  );
}

async function readFlow(c: Context<AppEnv>): Promise<OAuthState | null> {
  const cookie = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  if (!cookie) return null;
  const data = await verifySignedValue(c.env.SESSION_SECRET, cookie);
  if (!data) return null;
  return JSON.parse(utf8Decode(base64UrlDecode(data))) as OAuthState;
}

function adminRedirect(c: Context<AppEnv>, path: string, error?: string): Response {
  return c.redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

export const authRoutes = new Hono<AppEnv>();

/** 管理画面のログイン（各自の Google アカウント。設計書 7.1） */
authRoutes.get("/login", (c) => startFlow(c, "login"));

/** Google ドライブ・Gmail との連携（tamahouse0930@gmail.com で 1 回だけ許可する） */
authRoutes.get("/link", async (c) => {
  if (!(await readAdminSession(c))) return adminRedirect(c, "/admin", "ログインしてください");
  return startFlow(c, "link");
});

authRoutes.get("/callback", async (c) => {
  const flow = await readFlow(c);
  if (!flow || c.req.query("state") !== flow.state) {
    return adminRedirect(c, "/admin", "ログインの有効期限が切れました。もう一度お試しください");
  }
  const back = flow.mode === "login" ? "/admin" : "/admin/setup";
  const code = c.req.query("code");
  if (!code) return adminRedirect(c, back, "Google での許可が取り消されました");

  let tokens;
  let claims;
  try {
    tokens = await exchangeCode(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, code, flow.verifier, redirectUri(c));
    if (!tokens.id_token) throw new Error("ID トークンを受け取れませんでした");
    claims = verifyIdTokenClaims(tokens.id_token, c.env.GOOGLE_CLIENT_ID, flow.nonce);
  } catch (error) {
    console.error(JSON.stringify({ event: "oauth_failed", mode: flow.mode, message: String(error) }));
    return adminRedirect(c, back, "Google でのログインに失敗しました。もう一度お試しください");
  }

  const db = c.var.db;
  const userAgent = c.req.header("User-Agent")?.slice(0, 200) ?? null;

  if (flow.mode === "login") {
    const settings = await getSettings(db);
    if (!settings.adminEmails.has(claims.email)) {
      return adminRedirect(c, "/admin", `${claims.email} ではログインできません。登録済みのアカウントでログインしてください`);
    }
    const sid = randomToken();
    const payload = newSessionPayload(sid, claims.email);
    await db.batch([
      db
        .prepare(
          "INSERT INTO admin_sessions (id, email, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(sid, claims.email, userAgent, nowIso(), nowIso(), new Date(payload.exp).toISOString()),
      auditStatement(db, `admin:${claims.email}`, "login"),
    ]);
    setSessionCookie(c, await encodeSession(c.env.SESSION_SECRET, payload));
    c.executionCtx.waitUntil(
      notifyHost(c.env, db, {
        subject: "管理画面へのログインがありました",
        text: [
          `アカウント: ${claims.email}`,
          `端末: ${userAgent ?? "不明"}`,
          `日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
          "",
          "身に覚えがない場合は、管理画面の設定「ログイン中の端末」からログアウトさせてください。",
        ].join("\n"),
      }),
    );
    return c.redirect(safeAdminPath(flow.next) ?? "/admin");
  }

  // 連携: ログイン中の管理者が、tamahouse0930@gmail.com で許可した場合だけ受け付ける
  const admin = await readAdminSession(c);
  if (!admin) return adminRedirect(c, "/admin", "ログインしてください");
  if (claims.email !== c.env.GOOGLE_SERVICE_EMAIL.toLowerCase()) {
    return adminRedirect(c, back, `${c.env.GOOGLE_SERVICE_EMAIL} で許可してください（${claims.email} で許可されました）`);
  }
  if (!tokens.refresh_token) {
    return adminRedirect(c, back, "Google からリフレッシュトークンを受け取れませんでした。もう一度お試しください");
  }
  const scopes = tokens.scope.split(" ");
  if (!LINK_SCOPES.split(" ").filter((s) => s.startsWith("https://")).every((s) => scopes.includes(s))) {
    return adminRedirect(c, back, "メールの送信とドライブへの保存の両方を許可してください");
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO google_link (id, account_email, scopes, refresh_token_enc, linked_at, last_error)
         VALUES (1, ?, ?, ?, ?, NULL)
         ON CONFLICT (id) DO UPDATE SET account_email = excluded.account_email, scopes = excluded.scopes,
           refresh_token_enc = excluded.refresh_token_enc, linked_at = excluded.linked_at, last_error = NULL`,
      )
      .bind(claims.email, tokens.scope, await encryptText(c.env.TOKEN_ENC_KEY, tokens.refresh_token), nowIso()),
    auditStatement(db, `admin:${admin.email}`, "google_link", claims.email),
  ]);
  invalidateSettings();
  clearGoogleAccessToken();

  try {
    await ensureRootFolder(c.env, db);
  } catch (error) {
    return adminRedirect(c, back, `連携はできましたが、ドライブにフォルダを作れませんでした: ${String(error)}`);
  }
  return c.redirect(`${back}?linked=1`);
});
