import type { Env } from "../../env";
import type { Db } from "../../lib/db";
import { base64UrlEncode, utf8Encode } from "../../lib/crypto";
import { getGoogleAccessToken, recordGoogleError } from "./token";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

function utf8Base64(text: string): string {
  let binary = "";
  for (const b of utf8Encode(text)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function encodeHeader(text: string): string {
  return `=?UTF-8?B?${utf8Base64(text)}?=`;
}

function encodeBody(text: string): string {
  return utf8Base64(text).replace(/.{1,76}/g, "$&\r\n");
}

export function buildRawMessage(from: string, message: MailMessage): string {
  const lines = [
    `From: ${from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(message.text),
  ];
  return base64UrlEncode(utf8Encode(lines.join("\r\n")));
}

/** 管理用の Gmail（tamahouse0930@gmail.com）からメールを送る。1 通の宛先に全員を並べる */
export async function sendMail(env: Env, db: Db, message: MailMessage): Promise<void> {
  if (message.to.length === 0) return;
  const token = await getGoogleAccessToken(env, db);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: buildRawMessage(env.GOOGLE_SERVICE_EMAIL, message) }),
  });
  if (!res.ok) {
    const error = `通知メールの送信に失敗しました（HTTP ${res.status}）`;
    await recordGoogleError(db, error);
    throw new Error(error);
  }
}
