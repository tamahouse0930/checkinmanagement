import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getSettings } from "../lib/settings";

/** 公開ページ（ホームページ・プライバシーポリシー）用の情報。設定のキャッシュから返す */
export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/info", async (c) => {
  const { property } = await getSettings(c.var.db);
  return c.json({
    name: property.name,
    operatorName: property.operator_name,
    operatorContact: property.operator_contact,
  });
});
