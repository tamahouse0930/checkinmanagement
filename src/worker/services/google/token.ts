import type { Env } from "../../env";
import type { Db } from "../../lib/db";
import { decryptText } from "../../lib/crypto";
import { getSettings, invalidateSettings } from "../../lib/settings";
import { TOKEN_ENDPOINT } from "./oauth";

export class GoogleNotLinkedError extends Error {
  constructor(message = "Google ドライブ・Gmail と連携されていません") {
    super(message);
  }
}

/** アクセストークン（1 時間有効）は Worker のメモリで使い回す */
let cached: { token: string; expires: number } | null = null;

export async function getGoogleAccessToken(env: Env, db: Db): Promise<string> {
  const now = Date.now();
  if (cached && cached.expires > now + 60_000) return cached.token;

  const { googleLink } = await getSettings(db);
  if (!googleLink) throw new GoogleNotLinkedError();

  const refreshToken = await decryptText(env.TOKEN_ENC_KEY, googleLink.refresh_token_enc);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const message = detail.includes("invalid_grant")
      ? "Google との連携が切れています。設定画面で「Google と連携」を押し直してください"
      : `Google のアクセストークンを取得できませんでした（HTTP ${res.status}）`;
    await recordGoogleError(db, message);
    throw new GoogleNotLinkedError(message);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: now + body.expires_in * 1000 };
  return body.access_token;
}

export function clearGoogleAccessToken(): void {
  cached = null;
}

/** 連携のエラーを記録し、管理画面の「要対応」に出せるようにする */
export async function recordGoogleError(db: Db, message: string | null): Promise<void> {
  await db.run(db.prepare("UPDATE google_link SET last_error = ? WHERE id = 1").bind(message));
  invalidateSettings();
}
