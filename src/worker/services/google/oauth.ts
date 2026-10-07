import { base64UrlDecode, base64UrlEncode, randomToken, sha256, utf8Decode } from "../../lib/crypto";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** 管理画面のログインに求める権限 */
export const LOGIN_SCOPES = "openid email";
/** Google との連携の用途。通知メールの送信と写真の保存で、別のアカウントにできる */
export type GooglePurpose = "mail" | "drive";
export const GOOGLE_PURPOSES: GooglePurpose[] = ["mail", "drive"];
/** 用途ごとに求める権限（メールの送信だけ／このアプリが作ったファイルだけ） */
export const PURPOSE_SCOPE: Record<GooglePurpose, string> = {
  mail: "https://www.googleapis.com/auth/gmail.send",
  drive: "https://www.googleapis.com/auth/drive.file",
};
export function linkScopes(purpose: GooglePurpose): string {
  return ["openid", "email", PURPOSE_SCOPE[purpose]].join(" ");
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export async function createPkce(): Promise<Pkce> {
  const verifier = randomToken(32);
  return { verifier, challenge: base64UrlEncode(await sha256(verifier)) };
}

export interface AuthUrlOptions {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** リフレッシュトークンを受け取る（ドライブ・Gmail の連携） */
  offline?: boolean;
  loginHint?: string;
}

export function buildAuthUrl(o: AuthUrlOptions): string {
  const params = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: o.scope,
    state: o.state,
    nonce: o.nonce,
    code_challenge: o.codeChallenge,
    code_challenge_method: "S256",
  });
  if (o.offline) {
    params.set("access_type", "offline");
    // 毎回同意画面を出し、確実にリフレッシュトークンを受け取る
    params.set("prompt", "consent");
  } else {
    params.set("prompt", "select_account");
  }
  if (o.loginHint) params.set("login_hint", o.loginHint);
  return `${AUTH_ENDPOINT}?${params}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  scope: string;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Google のトークン交換に失敗しました（HTTP ${res.status}）`);
  return res.json();
}

export interface IdTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  email?: string;
  email_verified?: boolean;
  nonce?: string;
}

/**
 * ID トークンの内容を確認する。トークンは Google のトークン窓口から TLS で直接受け取ったものなので、
 * 署名の検証は省略し（OpenID Connect Core 3.1.3.7）、発行元・宛先・有効期限・nonce を確認する。
 */
export function verifyIdTokenClaims(
  idToken: string,
  clientId: string,
  nonce: string,
  now = Date.now(),
): IdTokenClaims & { email: string } {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("ID トークンの形式が不正です");
  const claims = JSON.parse(utf8Decode(base64UrlDecode(parts[1]))) as IdTokenClaims;
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") {
    throw new Error("ID トークンの発行元が不正です");
  }
  if (claims.aud !== clientId) throw new Error("ID トークンの宛先が不正です");
  if (claims.exp * 1000 <= now) throw new Error("ID トークンの有効期限が切れています");
  if (claims.nonce !== nonce) throw new Error("ID トークンの nonce が一致しません");
  if (!claims.email || claims.email_verified !== true) throw new Error("メールアドレスが確認されていません");
  return { ...claims, email: claims.email.toLowerCase() };
}
