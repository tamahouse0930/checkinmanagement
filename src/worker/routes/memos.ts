import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { nowIso } from "../lib/time";

/**
 * 全体メモ（要件定義書 H-34）。清掃のときに気づいた購入依頼などを書き、管理者同士で共有する。
 * メールは送らず、未対応の件数を管理画面のメニューに出す
 */
export const memoRoutes = new Hono<AppEnv>();

export const MEMO_MAX_LENGTH = 500;
/** 一覧に出す件数の上限（未対応・対応済みそれぞれ） */
const LIST_LIMIT = 100;
const DONE_LIMIT = 30;

interface MemoRow {
  id: string;
  body: string;
  created_by: string;
  created_at: string;
  done_at: string | null;
  done_by: string | null;
}

const toView = (m: MemoRow) => ({
  id: m.id,
  body: m.body,
  createdBy: m.created_by,
  createdAt: m.created_at,
  doneAt: m.done_at,
  doneBy: m.done_by,
});

memoRoutes.get("/memos", async (c) => {
  const db = c.var.db;
  const [open, done] = await db.batch<MemoRow>([
    db.prepare("SELECT * FROM memos WHERE done_at IS NULL ORDER BY created_at DESC LIMIT ?").bind(LIST_LIMIT),
    db.prepare("SELECT * FROM memos WHERE done_at IS NOT NULL ORDER BY done_at DESC LIMIT ?").bind(DONE_LIMIT),
  ]);
  return c.json({ open: open.results.map(toView), done: done.results.map(toView) });
});

/** 未対応の件数（メニューに出す） */
memoRoutes.get("/memos/count", async (c) => {
  const db = c.var.db;
  const row = await db.first<{ n: number }>(db.prepare("SELECT COUNT(*) AS n FROM memos WHERE done_at IS NULL"));
  return c.json({ open: row?.n ?? 0 });
});

memoRoutes.post("/memos", async (c) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(MEMO_MAX_LENGTH) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: `1〜${MEMO_MAX_LENGTH} 文字で入力してください` } }, 400);
  const db = c.var.db;
  const id = crypto.randomUUID();
  const actor = c.var.admin.email;
  await db.batch([
    db.prepare("INSERT INTO memos (id, body, created_by, created_at) VALUES (?, ?, ?, ?)").bind(id, parsed.data.body, actor, nowIso()),
    auditStatement(db, `admin:${actor}`, "add_memo", id),
  ]);
  return c.json({ id });
});

memoRoutes.post("/memos/:id/done", async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const actor = c.var.admin.email;
  await db.batch([
    db.prepare("UPDATE memos SET done_at = ?, done_by = ? WHERE id = ? AND done_at IS NULL").bind(nowIso(), actor, id),
    auditStatement(db, `admin:${actor}`, "done_memo", id),
  ]);
  return c.json({ ok: true });
});

memoRoutes.post("/memos/:id/reopen", async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  await db.batch([
    db.prepare("UPDATE memos SET done_at = NULL, done_by = NULL WHERE id = ?").bind(id),
    auditStatement(db, `admin:${c.var.admin.email}`, "reopen_memo", id),
  ]);
  return c.json({ ok: true });
});

memoRoutes.delete("/memos/:id", async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  await db.batch([
    db.prepare("DELETE FROM memos WHERE id = ?").bind(id),
    auditStatement(db, `admin:${c.var.admin.email}`, "delete_memo", id),
  ]);
  return c.json({ ok: true });
});
