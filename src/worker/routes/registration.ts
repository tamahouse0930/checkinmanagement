import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { isCountryCode } from "../../shared/countries";
import { formatDateJa, jstNow } from "../../shared/dates";
import type { RegistrationView } from "../../shared/api-types";
import { type GuestFields, normalizeGuest } from "../../shared/guest";
import { isLang, LANGS, type Lang } from "../../shared/langs";
import { parseMrz } from "../../shared/mrz";
import type { AppEnv } from "../env";
import { randomToken } from "../lib/crypto";
import { getSettings, getText } from "../lib/settings";
import { nowIso } from "../lib/time";
import { downloadFile, ocrImage } from "../services/google/drive";
import { GoogleNotLinkedError } from "../services/google/token";
import {
  countersStatement,
  type GuestRow,
  loadGuests,
  passportCheckFor,
  type ReservationRow,
  statusFor,
  toFields,
  toView,
  upsertGuestStatement,
} from "../services/guests";
import { notifyHost } from "../services/notify";
import { deletePhotos, detectImageType, MAX_PHOTO_BYTES, renamePhotosForGuests, saveIdPhoto } from "../services/photos";

/** 宿泊者入力画面の API（設計書 5.1）。代表者は /api/r、同行者は /api/g */

export const MAX_GUESTS = 20;

function error(c: Context<AppEnv>, status: 400 | 403 | 404 | 409 | 413 | 502, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function bearer(c: Context<AppEnv>): string | null {
  const header = c.req.header("Authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9_-]{16,64})$/.exec(header);
  return m ? m[1] : null;
}

/** URL が使えるか（キャンセル・ブロックでない、チェックアウト日を過ぎていない。要件定義書 G-03） */
function usable(r: ReservationRow): boolean {
  return r.status === "confirmed" && r.check_out_date >= jstNow().date;
}

const representativeAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c);
  const db = c.var.db;
  const r = token
    ? await db.first<ReservationRow>(db.prepare("SELECT * FROM reservations WHERE guest_token = ?").bind(token))
    : null;
  if (!r || !usable(r)) return error(c, 404, "invalid_url", "invalid_url");
  c.set("reservation", r);
  c.set("companionSeq", null);
  await next();
};

const companionAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c);
  const db = c.var.db;
  const row = token
    ? await db.first<ReservationRow & { companion_seq: number }>(
        db
          .prepare("SELECT r.*, g.seq AS companion_seq FROM guests g JOIN reservations r ON r.id = g.reservation_id WHERE g.entry_token = ?")
          .bind(token),
      )
    : null;
  if (!row || !usable(row)) return error(c, 404, "invalid_url", "invalid_url");
  c.set("reservation", row);
  c.set("companionSeq", row.companion_seq);
  await next();
};

async function buildView(c: Context<AppEnv>, guests: GuestRow[]): Promise<RegistrationView> {
  const r = c.var.reservation;
  const settings = await getSettings(c.var.db);
  const origin = new URL(c.req.url).origin;
  const companionSeq = c.var.companionSeq;
  const visible = companionSeq === null ? guests : guests.filter((g) => g.seq === companionSeq);
  return {
    role: companionSeq === null ? "representative" : "companion",
    property: {
      name: settings.property.name,
      checkinTime: settings.property.checkin_time,
      checkoutTime: settings.property.checkout_time,
    },
    checkInDate: r.check_in_date,
    checkOutDate: r.check_out_date,
    regStatus: r.reg_status,
    rejectReason: r.reject_reason,
    guestTotal: r.guest_total,
    // 同行者の画面に、他の同行者用の URL は出さない。当日の写真はゲストの画面には出さない
    guests: visible.map((g) => ({
      ...toView(g, origin),
      entryUrl: companionSeq === null ? toView(g, origin).entryUrl : null,
      kioskPhotoId: null,
      checkedInAt: null,
    })),
    companionSeq,
    houseRules: Object.fromEntries(LANGS.map((l) => [l, getText(settings, "house_rules", l)])) as Record<Lang, string>,
    isTest: r.is_test === 1,
  };
}

export const guestPatchSchema = z
  .object({
    isJapanese: z.boolean().nullable(),
    fullName: z.string().max(200),
    addressCountry: z.string().refine((v) => v === "" || isCountryCode(v)),
    address: z.string().max(600),
    occupation: z.string().max(200),
    contact: z.string().max(200),
    nationality: z.string().refine((v) => v === "" || isCountryCode(v)),
    passportNumber: z.string().max(30),
    isUnder16: z.boolean(),
    consent: z.boolean(),
    /** 写真（MRZ）から読み取った旅券番号。読み取れなかったときは null、読み取りを試していなければ送らない */
    passportMrzNumber: z.string().max(20).nullable(),
  })
  .partial();

/**
 * 1 人分の保存（途中保存を含む。要件定義書 G-12）。
 * - 承認済みの人は変更できない（G-22）
 * - 送信後（承認前）に代表者が修正したら、送信前の状態に戻す（もう一度送信してもらう）
 */
async function saveGuest(c: Context<AppEnv>, seq: number, body: unknown, asCompanion: boolean) {
  const r = c.var.reservation;
  const parsed = guestPatchSchema.safeParse(body);
  if (!parsed.success) return error(c, 400, "bad_request", "invalid_input");
  if (seq < 1 || seq > r.guest_total) return error(c, 404, "not_found", "not_found");

  const db = c.var.db;
  const guests = await loadGuests(db, r.id);
  const row = guests.find((g) => g.seq === seq) ?? null;
  if (row?.status === "approved") return error(c, 409, "locked", "locked");
  if (asCompanion && (r.reg_status === "submitted" || row?.status === "submitted")) {
    return error(c, 409, "locked", "locked");
  }

  const { consent, passportMrzNumber, ...patch } = parsed.data;
  const fields: GuestFields = { ...toFields(row), ...patch };
  const mrzNumber = passportMrzNumber !== undefined ? passportMrzNumber : (row?.passport_mrz_number ?? null);
  const ocrTried = passportMrzNumber !== undefined || row?.passport_check != null;
  const passport = { mrzNumber, check: passportCheckFor(normalizeGuest(fields), mrzNumber, ocrTried) };
  const now = nowIso();
  const consentAt = asCompanion ? (consent === true ? now : consent === false ? null : row?.consent_at ?? null) : row?.consent_at ?? null;
  const enteredBy = asCompanion ? "self" : "representative";
  const status = statusFor(fields, asCompanion, consentAt !== null);

  const stmts: D1PreparedStatement[] = [upsertGuestStatement(db, r.id, seq, fields, status, enteredBy, consentAt, now, passport)];
  if (r.reg_status === "none") {
    stmts.push(db.prepare("UPDATE reservations SET reg_status = 'in_progress' WHERE id = ?").bind(r.id));
  } else if (r.reg_status === "submitted") {
    // 送信後の修正: 送信済みの人を入力済みに戻し、もう一度送信してもらう
    stmts.push(db.prepare("UPDATE guests SET status = 'ready' WHERE reservation_id = ? AND status = 'submitted'").bind(r.id));
    stmts.push(db.prepare("UPDATE reservations SET reg_status = 'in_progress' WHERE id = ?").bind(r.id));
  }
  stmts.push(countersStatement(db, r.id, now));
  await db.batch(stmts);
  return c.json({ status });
}

/** 身分証の写真のアップロード（multipart: seq, file） */
async function uploadPhoto(c: Context<AppEnv>, seq: number) {
  const r = c.var.reservation;
  if (seq < 1 || seq > r.guest_total) return error(c, 404, "not_found", "not_found");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error(c, 400, "bad_request", "no_file");
  if (file.size > MAX_PHOTO_BYTES) return error(c, 413, "too_large", "too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageType(bytes);
  if (!mime) return error(c, 400, "bad_request", "not_image");

  const db = c.var.db;
  const now = nowIso();
  let guests = await loadGuests(db, r.id);
  let row = guests.find((g) => g.seq === seq);
  if (row?.status === "approved") return error(c, 409, "locked", "locked");
  if (c.var.companionSeq !== null && (r.reg_status === "submitted" || row?.status === "submitted")) {
    return error(c, 409, "locked", "locked");
  }
  if (!row) {
    await db.batch([
      upsertGuestStatement(db, r.id, seq, toFields(null), "draft", c.var.companionSeq === null ? "representative" : "self", null, now),
      ...(r.reg_status === "none" ? [db.prepare("UPDATE reservations SET reg_status = 'in_progress' WHERE id = ?").bind(r.id)] : []),
    ]);
    guests = await loadGuests(db, r.id);
    row = guests.find((g) => g.seq === seq)!;
  }

  let photoId: string;
  try {
    photoId = await saveIdPhoto(c.env, db, r, row, bytes, mime);
  } catch (e) {
    console.error(JSON.stringify({ event: "photo_upload_failed", message: String(e), notLinked: e instanceof GoogleNotLinkedError }));
    return error(c, 502, "upload_failed", "upload_failed");
  }

  // 写真がそろったことで入力済みになる場合があるため、状態を計算し直す
  const fields = { ...toFields(row), idPhotoId: photoId };
  const asCompanion = c.var.companionSeq !== null;
  const status = statusFor(fields, asCompanion, row.consent_at !== null);
  await db.batch([
    db.prepare("UPDATE guests SET status = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'ready')").bind(status, now, row.id),
    countersStatement(db, r.id, now),
  ]);
  return c.json({ photoId, status });
}

async function servePhoto(c: Context<AppEnv>, photoId: string, allowedGuestSeq: number | null) {
  const r = c.var.reservation;
  if (r.reg_status === "approved") return error(c, 403, "forbidden", "forbidden");
  const db = c.var.db;
  const photo = await db.first<{ drive_file_id: string; seq: number }>(
    db
      .prepare("SELECT p.drive_file_id, g.seq FROM photos p JOIN guests g ON g.id = p.guest_id WHERE p.id = ? AND p.reservation_id = ?")
      .bind(photoId, r.id),
  );
  if (!photo || (allowedGuestSeq !== null && photo.seq !== allowedGuestSeq)) return error(c, 404, "not_found", "not_found");
  const res = await downloadFile(c.env, db, photo.drive_file_id).catch(() => null);
  if (!res) return error(c, 404, "not_found", "not_found");
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": "private, no-store" },
  });
}

/**
 * 保存済みのパスポートの写真から MRZ を読み取る（要件定義書 G-16）。文字認識は Google ドライブで行うため、
 * ゲストのスマホでは読み取り用のデータのダウンロードも計算もしない。読み取れなければ result は null
 */
async function readPassportPhoto(c: Context<AppEnv>, photoId: string, allowedGuestSeq: number | null) {
  const r = c.var.reservation;
  const db = c.var.db;
  const photo = await db.first<{ drive_file_id: string; seq: number }>(
    db
      .prepare("SELECT p.drive_file_id, g.seq FROM photos p JOIN guests g ON g.id = p.guest_id WHERE p.id = ? AND p.reservation_id = ?")
      .bind(photoId, r.id),
  );
  if (!photo || (allowedGuestSeq !== null && photo.seq !== allowedGuestSeq)) return error(c, 404, "not_found", "not_found");
  try {
    const text = await ocrImage(c.env, db, photo.drive_file_id);
    return c.json({ result: text ? parseMrz(text) : null });
  } catch (e) {
    console.error(JSON.stringify({ event: "passport_ocr_failed", message: String(e) }));
    return error(c, 502, "ocr_failed", "ocr_failed");
  }
}

// ---- 代表者 ----

export const representativeRoutes = new Hono<AppEnv>();
representativeRoutes.use("*", representativeAuth);

representativeRoutes.get("/", async (c) => c.json(await buildView(c, await loadGuests(c.var.db, c.var.reservation.id))));

/** 宿泊人数（承認前だけ。承認後は「同行者を追加」を使う） */
representativeRoutes.put("/guest-count", async (c) => {
  const r = c.var.reservation;
  const parsed = z.object({ count: z.number().int().min(1).max(MAX_GUESTS) }).safeParse(await c.req.json());
  if (!parsed.success) return error(c, 400, "bad_request", "invalid_input");
  if (r.reg_status === "approved") return error(c, 409, "locked", "locked");
  const count = parsed.data.count;
  const db = c.var.db;
  const now = nowIso();
  const removed = (await loadGuests(db, r.id)).filter((g) => g.seq > count);
  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE reservations SET guest_total = ?, updated_at = ? WHERE id = ?").bind(count, now, r.id),
  ];
  if (removed.length > 0) stmts.push(db.prepare("DELETE FROM guests WHERE reservation_id = ? AND seq > ?").bind(r.id, count));
  if (r.reg_status === "none") stmts.push(db.prepare("UPDATE reservations SET reg_status = 'in_progress' WHERE id = ?").bind(r.id));
  if (r.reg_status === "submitted") {
    stmts.push(db.prepare("UPDATE guests SET status = 'ready' WHERE reservation_id = ? AND status = 'submitted'").bind(r.id));
    stmts.push(db.prepare("UPDATE reservations SET reg_status = 'in_progress' WHERE id = ?").bind(r.id));
  }
  stmts.push(countersStatement(db, r.id, now));
  await db.batch(stmts);
  await deletePhotos(c.env, db, removed.map((g) => g.id_photo_id).filter((id): id is string => Boolean(id)));
  return c.json({ ok: true });
});

representativeRoutes.put("/guests/:seq", async (c) => saveGuest(c, Number(c.req.param("seq")), await c.req.json(), false));

/** 同行者用のリンクの発行（要件定義書 G-11） */
representativeRoutes.post("/guests/:seq/link", async (c) => {
  const r = c.var.reservation;
  const seq = Number(c.req.param("seq"));
  if (!(seq >= 2 && seq <= r.guest_total)) return error(c, 404, "not_found", "not_found");
  const db = c.var.db;
  const now = nowIso();
  const row = (await loadGuests(db, r.id)).find((g) => g.seq === seq);
  if (row?.status === "approved") return error(c, 409, "locked", "locked");
  if (row?.entry_token) return c.json({ url: `${new URL(c.req.url).origin}/g/${row.entry_token}` });
  const token = randomToken();
  const stmts: D1PreparedStatement[] = [];
  if (!row) stmts.push(upsertGuestStatement(db, r.id, seq, toFields(null), "draft", "self", null, now));
  stmts.push(db.prepare("UPDATE guests SET entry_token = ? WHERE reservation_id = ? AND seq = ?").bind(token, r.id, seq));
  if (r.reg_status === "none") stmts.push(db.prepare("UPDATE reservations SET reg_status = 'in_progress' WHERE id = ?").bind(r.id));
  stmts.push(countersStatement(db, r.id, now));
  await db.batch(stmts);
  return c.json({ url: `${new URL(c.req.url).origin}/g/${token}` });
});

representativeRoutes.post("/photos", async (c) => {
  const seq = Number(new URL(c.req.url).searchParams.get("seq"));
  return uploadPhoto(c, seq);
});

representativeRoutes.get("/photos/:id", (c) => servePhoto(c, c.req.param("id"), null));
representativeRoutes.post("/photos/:id/ocr", (c) => readPassportPhoto(c, c.req.param("id"), null));

/** 承認後の同行者の追加（要件定義書 G-21） */
representativeRoutes.post("/additions", async (c) => {
  const r = c.var.reservation;
  if (r.reg_status !== "approved") return error(c, 409, "not_approved", "not_approved");
  if (r.guest_total >= MAX_GUESTS) return error(c, 400, "too_many", "too_many");
  const db = c.var.db;
  await db.run(db.prepare("UPDATE reservations SET guest_total = guest_total + 1, updated_at = ? WHERE id = ?").bind(nowIso(), r.id));
  return c.json({ seq: r.guest_total + 1 });
});

/**
 * 送信（要件定義書 G-13）。承認前は全員分、承認後は追加した人の分を送る
 */
representativeRoutes.post("/submit", async (c) => {
  const r = c.var.reservation;
  const parsed = z
    .object({ consent: z.literal(true), consentForCompanions: z.boolean().optional(), lang: z.string() })
    .safeParse(await c.req.json());
  if (!parsed.success) return error(c, 400, "bad_request", "consent_required");
  if (r.reg_status === "submitted") return c.json({ ok: true });

  const db = c.var.db;
  const guests = await loadGuests(db, r.id);
  const inRange = guests.filter((g) => g.seq <= r.guest_total);
  const pending = inRange.filter((g) => g.status !== "approved");
  const allEntered = inRange.length === r.guest_total && pending.every((g) => g.status === "ready" || g.status === "submitted");
  if (!allEntered || pending.length === 0) return error(c, 409, "incomplete", "incomplete");
  const enteredByRep = pending.some((g) => g.seq > 1 && g.entered_by === "representative");
  if (enteredByRep && parsed.data.consentForCompanions !== true) return error(c, 400, "bad_request", "consent_required");

  const now = nowIso();
  const lang = isLang(parsed.data.lang) ? parsed.data.lang : "en";
  const isAddition = r.reg_status === "approved";
  await db.batch([
    db.prepare("UPDATE guests SET status = 'submitted', updated_at = ? WHERE reservation_id = ? AND status = 'ready'").bind(now, r.id),
    isAddition
      ? db.prepare("UPDATE reservations SET lang = ?, updated_at = ? WHERE id = ?").bind(lang, now, r.id)
      : db
          .prepare(
            `UPDATE reservations SET reg_status = 'submitted', submitted_at = ?, consent_at = ?, consent_for_companions = ?,
               reject_reason = NULL, lang = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(now, now, enteredByRep ? 1 : 0, lang, now, r.id),
    countersStatement(db, r.id, now),
  ]);

  await renamePhotosForGuests(c.env, db, r.id, pending).catch((e) =>
    console.error(JSON.stringify({ event: "photo_rename_failed", message: String(e) })),
  );
  const origin = new URL(c.req.url).origin;
  // パスポート番号が写真と違う人（見逃さないよう、通知にも書く。ゲストの画面には出さない）
  const mismatch = pending.filter((g) => g.passport_check === "mismatch").map((g) => g.full_name ?? `${g.seq}人目`);
  c.executionCtx.waitUntil(
    notifyHost(c.env, db, {
      isTest: r.is_test === 1,
      subject: isAddition ? "同行者の追加がありました（承認をお願いします）" : "宿泊者の登録がありました（承認をお願いします）",
      text: [
        `宿泊日: ${formatDateJa(r.check_in_date)} 〜 ${formatDateJa(r.check_out_date)}`,
        `代表者: ${guests.find((g) => g.seq === 1)?.full_name ?? "（未入力）"}`,
        `人数: ${r.guest_total}人${isAddition ? `（追加 ${pending.length}人）` : ""}`,
        ...(mismatch.length > 0 ? ["", `※ パスポート番号が写真から読み取った番号と違う人がいます: ${mismatch.join("、")}`] : []),
        "",
        `確認: ${origin}/admin/reservations/${r.id}`,
      ].join("\n"),
    }),
  );
  return c.json({ ok: true });
});

// ---- 同行者 ----

export const companionRoutes = new Hono<AppEnv>();
companionRoutes.use("*", companionAuth);

companionRoutes.get("/", async (c) => c.json(await buildView(c, await loadGuests(c.var.db, c.var.reservation.id))));
companionRoutes.put("/", async (c) => saveGuest(c, c.var.companionSeq!, await c.req.json(), true));
companionRoutes.post("/photos", (c) => uploadPhoto(c, c.var.companionSeq!));
companionRoutes.get("/photos/:id", (c) => servePhoto(c, c.req.param("id"), c.var.companionSeq));
companionRoutes.post("/photos/:id/ocr", (c) => readPassportPhoto(c, c.req.param("id"), c.var.companionSeq));
