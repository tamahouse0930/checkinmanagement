import { Hono, type Context } from "hono";
import { z } from "zod";
import { EMPTY_GUEST, type GuestFields, normalizeGuest } from "../../shared/guest";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";
import { nowIso } from "../lib/time";
import { countersStatement, type GuestRow, passportCheckFor, type ReservationRow, toFields } from "../services/guests";
import { deletePhotos, detectImageType, MAX_PHOTO_BYTES, renamePhotosForGuests, saveIdPhoto } from "../services/photos";
import { guestPatchSchema } from "./registration";

/** 管理者による名簿の修正・削除・追加（要件定義書 H-15、設計書 4.5） */
export const adminGuestRoutes = new Hono<AppEnv>();

function badRequest(c: Context<AppEnv>, message: string, status: 400 | 404 = 400) {
  return c.json({ error: { code: status === 404 ? "not_found" : "bad_request", message } }, status);
}

/** 宿泊者と、その予約を 1 回の一括実行で読む */
async function loadGuest(c: Context<AppEnv>, guestId: string): Promise<{ guest: GuestRow; reservation: ReservationRow } | null> {
  const db = c.var.db;
  const [g, r] = await db.batch([
    db.prepare("SELECT * FROM guests WHERE id = ?").bind(guestId),
    db.prepare("SELECT r.* FROM reservations r JOIN guests g ON g.reservation_id = r.id WHERE g.id = ?").bind(guestId),
  ]);
  const guest = g.results[0] as GuestRow | undefined;
  const reservation = r.results[0] as ReservationRow | undefined;
  return guest && reservation ? { guest, reservation } : null;
}

function fieldsStatement(c: Context<AppEnv>, guestId: string, fields: GuestFields, now: string) {
  const g = normalizeGuest(fields);
  return c.var.db
    .prepare(
      `UPDATE guests SET is_japanese = ?, full_name = ?, address_country = ?, address = ?, occupation = ?, contact = ?,
         nationality = ?, passport_number = ?, is_under16 = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      g.isJapanese === null ? null : g.isJapanese ? 1 : 0,
      g.fullName || null,
      g.addressCountry || null,
      g.address || null,
      g.occupation || null,
      g.contact || null,
      g.nationality || null,
      g.passportNumber || null,
      g.isUnder16 ? 1 : 0,
      now,
      guestId,
    );
}

function revisionStatement(
  c: Context<AppEnv>,
  guest: { id: string; reservation_id: string },
  action: "update" | "delete" | "replace_photo",
  before: unknown,
  after: unknown,
  reason: string | null,
) {
  return c.var.db
    .prepare(
      `INSERT INTO guest_revisions (id, guest_id, reservation_id, action, before_json, after_json, reason, admin_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      guest.id,
      guest.reservation_id,
      action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      reason,
      c.var.admin.email,
      nowIso(),
    );
}

/** 項目の修正（承認済みの人も修正できる。変更前と変更後を記録する） */
adminGuestRoutes.patch("/guests/:id", async (c) => {
  const body = await c.req.json();
  const parsed = guestPatchSchema.omit({ consent: true, passportMrzNumber: true }).safeParse(body);
  if (!parsed.success) return badRequest(c, "入力内容を確認してください");
  const loaded = await loadGuest(c, c.req.param("id"));
  if (!loaded) return badRequest(c, "宿泊者が見つかりません", 404);
  const { guest, reservation } = loaded;

  const before = toFields(guest);
  const after: GuestFields = { ...before, ...parsed.data };
  const now = nowIso();
  const db = c.var.db;
  const check = passportCheckFor(normalizeGuest(after), guest.passport_mrz_number, guest.passport_check !== null);
  await db.batch([
    fieldsStatement(c, guest.id, after, now),
    db.prepare("UPDATE guests SET passport_check = ? WHERE id = ?").bind(check, guest.id),
    revisionStatement(c, guest, "update", before, normalizeGuest(after), typeof body.reason === "string" ? body.reason.slice(0, 500) : null),
    countersStatement(db, reservation.id, now),
    auditStatement(db, `admin:${c.var.admin.email}`, "update_guest", guest.id),
  ]);
  // 氏名を変えたら、Google ドライブの写真のファイル名も合わせる
  if ((after.fullName ?? "") !== (guest.full_name ?? "")) {
    await renamePhotosForGuests(c.env, db, reservation.id, [{ id: guest.id, seq: guest.seq, full_name: normalizeGuest(after).fullName }]).catch(
      (e) => console.error(JSON.stringify({ event: "photo_rename_failed", message: String(e) })),
    );
  }
  return c.json({ ok: true });
});

/** 身分証の写真の差し替え（古い写真はドライブからも削除する） */
adminGuestRoutes.put("/guests/:id/photo", async (c) => {
  const loaded = await loadGuest(c, c.req.param("id"));
  if (!loaded) return badRequest(c, "宿泊者が見つかりません", 404);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest(c, "写真を選んでください");
  if (file.size > MAX_PHOTO_BYTES) return badRequest(c, "写真が大きすぎます（3 MB まで）");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageType(bytes);
  if (!mime) return badRequest(c, "JPEG・PNG・WebP の写真を選んでください");

  const { guest, reservation } = loaded;
  let photoId: string;
  try {
    photoId = await saveIdPhoto(c.env, c.var.db, reservation, guest, bytes, mime);
  } catch (e) {
    return c.json({ error: { code: "upload_failed", message: `写真を保存できませんでした: ${e instanceof Error ? e.message : String(e)}` } }, 502);
  }
  const db = c.var.db;
  await db.batch([
    revisionStatement(c, guest, "replace_photo", { idPhotoId: guest.id_photo_id }, { idPhotoId: photoId }, null),
    auditStatement(db, `admin:${c.var.admin.email}`, "replace_guest_photo", guest.id),
  ]);
  return c.json({ ok: true, photoId });
});

/**
 * 宿泊者の削除（来なかった人など。理由が必須）。チェックインした人は宿泊したので削除できない（3 年間の保存が必要）。
 * 代表者（1 人目）は削除できない。後ろの番号の人を 1 つずつ詰める
 */
adminGuestRoutes.delete("/guests/:id", async (c) => {
  const parsed = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(c, "削除の理由を入力してください");
  const loaded = await loadGuest(c, c.req.param("id"));
  if (!loaded) return badRequest(c, "宿泊者が見つかりません", 404);
  const { guest, reservation } = loaded;
  if (guest.checked_in_at) return badRequest(c, "チェックインした宿泊者は削除できません（名簿と写真は 3 年間の保存が必要です）");
  if (guest.seq === 1) return badRequest(c, "代表者は削除できません（内容を修正してください）");

  const db = c.var.db;
  const now = nowIso();
  const photoIds = [guest.id_photo_id, guest.kiosk_photo_id].filter((id): id is string => Boolean(id));
  await db.batch([
    db.prepare("DELETE FROM guests WHERE id = ?").bind(guest.id),
    // 一意制約（予約・番号）にぶつからないよう、いったん負の番号にしてから詰める
    db.prepare("UPDATE guests SET seq = -(seq - 1) WHERE reservation_id = ? AND seq > ?").bind(reservation.id, guest.seq),
    db.prepare("UPDATE guests SET seq = -seq WHERE reservation_id = ? AND seq < 0").bind(reservation.id),
    db.prepare("UPDATE reservations SET guest_total = MAX(guest_total - 1, 1) WHERE id = ?").bind(reservation.id),
    revisionStatement(c, guest, "delete", { seq: guest.seq, fullName: guest.full_name }, null, parsed.data.reason),
    countersStatement(db, reservation.id, now),
    auditStatement(db, `admin:${c.var.admin.email}`, "delete_guest", guest.id),
  ]);
  await deletePhotos(c.env, db, photoIds);
  // 番号が変わった人の写真のファイル名を合わせる
  const moved = await db.all<{ id: string; seq: number; full_name: string | null }>(
    db.prepare("SELECT id, seq, full_name FROM guests WHERE reservation_id = ? AND seq >= ? ORDER BY seq LIMIT 50").bind(reservation.id, guest.seq),
  );
  await renamePhotosForGuests(c.env, db, reservation.id, moved).catch(() => undefined);
  return c.json({ ok: true });
});

/** 管理者による宿泊者の追加（予約サイトのメッセージで情報を受け取った場合など。そのまま承認済みにする） */
adminGuestRoutes.post("/reservations/:id/guests", async (c) => {
  const parsed = guestPatchSchema.omit({ consent: true, passportMrzNumber: true }).safeParse(await c.req.json());
  if (!parsed.success) return badRequest(c, "入力内容を確認してください");
  const db = c.var.db;
  const id = c.req.param("id");
  const r = await db.first<ReservationRow>(db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id));
  if (!r) return badRequest(c, "予約が見つかりません", 404);
  if (r.status !== "confirmed") return badRequest(c, "キャンセル・ブロックの予約には追加できません");

  const seqRow = await db.first<{ n: number }>(db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM guests WHERE reservation_id = ?").bind(id));
  const seq = Math.max(seqRow?.n ?? 0, 0) + 1;
  const g = normalizeGuest({ ...EMPTY_GUEST, ...parsed.data });
  const now = nowIso();
  const guestId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO guests (id, reservation_id, seq, status, entered_by, is_japanese, full_name, address_country, address,
           occupation, contact, nationality, passport_number, is_under16, approved_at, created_at, updated_at)
         VALUES (?, ?, ?, 'approved', 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        guestId,
        id,
        seq,
        g.isJapanese === null ? null : g.isJapanese ? 1 : 0,
        g.fullName || null,
        g.addressCountry || null,
        g.address || null,
        g.occupation || null,
        g.contact || null,
        g.nationality || null,
        g.passportNumber || null,
        g.isUnder16 ? 1 : 0,
        now,
        now,
        now,
      ),
    db.prepare("UPDATE reservations SET guest_total = MAX(guest_total, ?) WHERE id = ?").bind(seq, id),
    revisionStatement(c, { id: guestId, reservation_id: id }, "update", null, g, "管理者が追加"),
    countersStatement(db, id, now),
    auditStatement(db, `admin:${c.var.admin.email}`, "add_guest", guestId),
  ]);
  return c.json({ ok: true, guestId });
});

/** 修正・削除の記録（予約ごと） */
adminGuestRoutes.get("/reservations/:id/revisions", async (c) => {
  const db = c.var.db;
  const rows = await db.all(
    db
      .prepare(
        `SELECT action, before_json, after_json, reason, admin_email, created_at FROM guest_revisions
         WHERE reservation_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(c.req.param("id")),
  );
  return c.json({ revisions: rows });
});
