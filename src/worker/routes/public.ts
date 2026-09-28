import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getSettings } from "../lib/settings";

/** 公開ページ（ホームページ・プライバシーポリシー）用の情報。設定のキャッシュから返す */
export const publicRoutes = new Hono<AppEnv>();

/** 設定の確認用。シークレットは値を出さず、登録されているか（と形式が正しいか）だけを返す */
publicRoutes.get("/health", (c) => {
  const env = c.env;
  let tokenKeyOk = false;
  try {
    tokenKeyOk = atob(env.TOKEN_ENC_KEY ?? "").length === 32;
  } catch {
    tokenKeyOk = false;
  }
  return c.json({
    secrets: {
      GOOGLE_CLIENT_ID: Boolean(env.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com")),
      GOOGLE_CLIENT_SECRET: Boolean(env.GOOGLE_CLIENT_SECRET),
      SESSION_SECRET: (env.SESSION_SECRET ?? "").length >= 32,
      TOKEN_ENC_KEY: tokenKeyOk,
    },
    serviceEmail: env.GOOGLE_SERVICE_EMAIL ?? null,
  });
});

publicRoutes.get("/info", async (c) => {
  const { property } = await getSettings(c.var.db);
  return c.json({
    name: property.name,
    operatorName: property.operator_name,
    operatorContact: property.operator_contact,
  });
});
