import type { MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "../env";

/**
 * 接続元の IP ごとの回数制限（設計書 7.2）。総当たりと、無料枠（Workers・D1）を使い切られるのを防ぐ。
 * 制限は Cloudflare のデータセンターごとに数えるため、おおよその値になる。
 * バインディングがない環境（単体テストなど）では制限しない
 */
export function rateLimit(binding: keyof Pick<Env, "PUBLIC_LIMITER" | "PAIR_LIMITER">): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[binding];
    if (limiter) {
      const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
      const { success } = await limiter.limit({ key: ip });
      if (!success) {
        console.log(JSON.stringify({ event: "rate_limited", binding, route: c.req.path.split("/").slice(0, 3).join("/") }));
        c.header("Retry-After", "60");
        return c.json({ error: { code: "rate_limited", message: "しばらく待ってからもう一度お試しください" } }, 429);
      }
    }
    await next();
  };
}
