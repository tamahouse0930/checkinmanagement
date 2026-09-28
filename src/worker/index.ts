import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { Db } from "./lib/db";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";

const app = new Hono<AppEnv>();

// D1 の読み書きの行数を 1 リクエストごとにログへ出す（設計書 11.4。個人情報は出さない）
app.use("*", async (c, next) => {
  const db = new Db(c.env.DB);
  c.set("db", db);
  await next();
  if (db.queries > 0) {
    console.log(
      JSON.stringify({
        event: "d1_usage",
        method: c.req.method,
        route: c.req.routePath,
        queries: db.queries,
        rows_read: db.rowsRead,
        rows_written: db.rowsWritten,
      }),
    );
  }
});

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
});

app.route("/auth/google", authRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/public", publicRoutes);

app.notFound((c) => c.json({ error: { code: "not_found", message: "見つかりません" } }, 404));
app.onError((error, c) => {
  console.error(JSON.stringify({ event: "unhandled_error", route: c.req.routePath, message: String(error) }));
  return c.json({ error: { code: "internal", message: "エラーが発生しました" } }, 500);
});

export default {
  fetch: app.fetch,
  // 定期処理（予約の取り込みなど）は段階 2 以降で実装する
  async scheduled() {},
} satisfies ExportedHandler<Env>;
