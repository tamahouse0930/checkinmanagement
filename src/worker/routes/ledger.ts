import { Hono } from "hono";
import { isValidDate } from "../../shared/dates";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";

/** 名簿管理（要件定義書 H-33、設計書 4.13）と名簿の CSV 出力（要件定義書 H-30） */
export const ledgerRoutes = new Hono<AppEnv>();

interface StayRow {
  id: string;
  check_in_date: string;
  check_out_date: string;
  channel: string;
  reservation_code: string | null;
  status: string;
  is_test: number;
  display_name: string | null;
  guest_total: number;
  guest_checked_in: number;
  photo_count: number;
  missing_count: number;
}

function range(c: { req: { query: (k: string) => string | undefined } }): { from: string; to: string } | null {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isValidDate(from) || !isValidDate(to) || from > to) return null;
  return { from, to };
}

/**
 * 名簿管理の検索結果（宿泊の一覧）。宿泊日（チェックイン日〜チェックアウト日）が期間に重なり、
 * 名簿か写真がある宿泊を返す。索引 idx_reservations_checkout で期間の予約に絞る
 */
ledgerRoutes.get("/stays", async (c) => {
  const period = range(c);
  if (!period) return c.json({ error: { code: "bad_request", message: "期間を指定してください" } }, 400);
  const name = (c.req.query("name") ?? "").trim().slice(0, 50);
  const db = c.var.db;
  const rows = await db.all<StayRow>(
    db
      .prepare(
        `SELECT r.id, r.check_in_date, r.check_out_date, r.channel, r.reservation_code, r.status, r.is_test, r.display_name,
           r.guest_total, r.guest_checked_in,
           (SELECT COUNT(*) FROM photos p WHERE p.reservation_id = r.id) AS photo_count,
           (SELECT COUNT(*) FROM photos p WHERE p.reservation_id = r.id AND p.missing_at IS NOT NULL) AS missing_count
         FROM reservations r
         WHERE r.check_out_date >= ? AND r.check_in_date <= ?
           AND (r.guest_total > 0 OR EXISTS (SELECT 1 FROM photos p WHERE p.reservation_id = r.id))
           AND (? = '' OR EXISTS (SELECT 1 FROM guests g WHERE g.reservation_id = r.id AND g.full_name LIKE '%' || ? || '%'))
         ORDER BY r.check_in_date LIMIT 300`,
      )
      .bind(period.from, period.to, name, name),
  );
  return c.json({
    stays: rows.map((r) => ({
      reservationId: r.id,
      checkInDate: r.check_in_date,
      checkOutDate: r.check_out_date,
      channel: r.channel,
      reservationCode: r.reservation_code,
      status: r.status,
      isTest: r.is_test === 1,
      representative: r.display_name,
      guestTotal: r.guest_total,
      guestCheckedIn: r.guest_checked_in,
      photoCount: r.photo_count,
      missingCount: r.missing_count,
    })),
  });
});

interface StayGuestRow {
  id: string;
  seq: number;
  status: string;
  full_name: string | null;
  is_japanese: number | null;
  nationality: string | null;
  passport_number: string | null;
  address_country: string | null;
  address: string | null;
  occupation: string | null;
  contact: string | null;
  is_under16: number;
  checked_in_at: string | null;
  id_photo_id: string | null;
  kiosk_photo_id: string | null;
}

interface StayPhotoRow {
  id: string;
  kind: "id" | "kiosk";
  file_name: string;
  drive_file_id: string;
  taken_at: string;
  missing_at: string | null;
}

/** 1 件の宿泊の名簿と、宿泊者ごとの事前登録の写真・チェックイン時の写真（1 回の一括実行で読む） */
ledgerRoutes.get("/stays/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.var.db;
  const [r, g, p] = await db.batch([
    db
      .prepare(
        `SELECT id, check_in_date, check_out_date, channel, reservation_code, status, is_test, first_checkin_at,
           checked_out_at, photos_verified_at, photo_mismatch FROM reservations WHERE id = ?`,
      )
      .bind(id),
    db.prepare("SELECT * FROM guests WHERE reservation_id = ? ORDER BY seq LIMIT 50").bind(id),
    db.prepare("SELECT id, kind, file_name, drive_file_id, taken_at, missing_at FROM photos WHERE reservation_id = ? LIMIT 200").bind(id),
  ]);
  const stay = r.results[0] as Record<string, unknown> | undefined;
  if (!stay) return c.json({ error: { code: "not_found", message: "宿泊が見つかりません" } }, 404);
  const photos = new Map((p.results as StayPhotoRow[]).map((ph) => [ph.id, ph]));
  const photoView = (photoId: string | null) => {
    const ph = photoId ? photos.get(photoId) : undefined;
    return ph
      ? {
          photoId: ph.id,
          fileName: ph.file_name,
          driveUrl: `https://drive.google.com/file/d/${ph.drive_file_id}/view`,
          takenAt: ph.taken_at,
          missing: ph.missing_at !== null,
        }
      : null;
  };
  return c.json({
    stay: {
      reservationId: stay.id,
      checkInDate: stay.check_in_date,
      checkOutDate: stay.check_out_date,
      channel: stay.channel,
      reservationCode: stay.reservation_code,
      status: stay.status,
      isTest: stay.is_test === 1,
      firstCheckinAt: stay.first_checkin_at,
      checkedOutAt: stay.checked_out_at,
      photosVerifiedAt: stay.photos_verified_at,
      photoMismatch: stay.photo_mismatch,
    },
    guests: (g.results as StayGuestRow[]).map((row) => ({
      id: row.id,
      seq: row.seq,
      status: row.status,
      fullName: row.full_name,
      isJapanese: row.is_japanese === null ? null : row.is_japanese === 1,
      nationality: row.nationality,
      passportNumber: row.passport_number,
      addressCountry: row.address_country,
      address: row.address,
      occupation: row.occupation,
      contact: row.contact,
      isUnder16: row.is_under16 === 1,
      checkedInAt: row.checked_in_at,
      idPhoto: photoView(row.id_photo_id),
      kioskPhoto: photoView(row.kiosk_photo_id),
    })),
  });
});

interface RegisterRow {
  reservation_id: string;
  check_in_date: string;
  check_out_date: string;
  channel: string;
  reservation_code: string | null;
  checked_out_at: string | null;
  seq: number;
  full_name: string | null;
  is_japanese: number | null;
  nationality: string | null;
  passport_number: string | null;
  address_country: string | null;
  address: string | null;
  occupation: string | null;
  contact: string | null;
  is_under16: number;
  checked_in_at: string | null;
  id_photo_id: string | null;
}

/**
 * 印刷・PDF 用の宿泊者名簿（行政から求められたときにすぐ出せるように）。CSV と同じ条件で、宿泊ごとにまとめて返す。
 * テスト予約は含めない
 */
ledgerRoutes.get("/register", async (c) => {
  const period = range(c);
  if (!period) return c.json({ error: { code: "bad_request", message: "期間を指定してください" } }, 400);
  const stayedOnly = c.req.query("stayed") !== "0";
  const db = c.var.db;
  const rows = await db.all<RegisterRow>(
    db
      .prepare(
        `SELECT r.id AS reservation_id, r.check_in_date, r.check_out_date, r.channel, r.reservation_code, r.checked_out_at,
           g.seq, g.full_name, g.is_japanese, g.nationality, g.passport_number, g.address_country, g.address,
           g.occupation, g.contact, g.is_under16, g.checked_in_at, g.id_photo_id
         FROM reservations r JOIN guests g ON g.reservation_id = r.id
         WHERE r.check_out_date >= ? AND r.check_in_date <= ? AND r.is_test = 0 AND r.status = 'confirmed'
           AND g.status = 'approved' AND (? = 0 OR g.checked_in_at IS NOT NULL)
         ORDER BY r.check_in_date, r.id, g.seq LIMIT 2000`,
      )
      .bind(period.from, period.to, stayedOnly ? 1 : 0),
  );

  const stays: {
    reservationId: string;
    checkInDate: string;
    checkOutDate: string;
    channel: string;
    reservationCode: string | null;
    checkedOutAt: string | null;
    guests: unknown[];
  }[] = [];
  for (const r of rows) {
    let stay = stays[stays.length - 1];
    if (!stay || stay.reservationId !== r.reservation_id) {
      stay = {
        reservationId: r.reservation_id,
        checkInDate: r.check_in_date,
        checkOutDate: r.check_out_date,
        channel: r.channel,
        reservationCode: r.reservation_code,
        checkedOutAt: r.checked_out_at,
        guests: [],
      };
      stays.push(stay);
    }
    stay.guests.push({
      seq: r.seq,
      fullName: r.full_name,
      isJapanese: r.is_japanese === null ? null : r.is_japanese === 1,
      nationality: r.nationality,
      passportNumber: r.passport_number,
      addressCountry: r.address_country,
      address: r.address,
      occupation: r.occupation,
      contact: r.contact,
      isUnder16: r.is_under16 === 1,
      checkedInAt: r.checked_in_at,
      idPhotoId: r.id_photo_id,
    });
  }
  c.executionCtx.waitUntil(
    db.run(auditStatement(db, `admin:${c.var.admin.email}`, "view_register", `${period.from}〜${period.to}（${rows.length}人）`)),
  );
  return c.json({ from: period.from, to: period.to, stayedOnly, guestCount: rows.length, stays });
});

interface RegistryRow {
  check_in_date: string;
  check_out_date: string;
  channel: string;
  reservation_code: string | null;
  checked_out_at: string | null;
  seq: number;
  full_name: string | null;
  is_japanese: number | null;
  nationality: string | null;
  passport_number: string | null;
  address_country: string | null;
  address: string | null;
  occupation: string | null;
  contact: string | null;
  is_under16: number;
  checked_in_at: string | null;
  id_file: string | null;
  kiosk_file: string | null;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function jst(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 名簿の CSV（Excel で開けるよう BOM 付き UTF-8、CRLF）。テスト予約は含めない。
 * stayed=1（既定）のときは、チェックインした人（宿泊した人）だけを出す
 */
ledgerRoutes.get("/registry.csv", async (c) => {
  const period = range(c);
  if (!period) return c.json({ error: { code: "bad_request", message: "期間を指定してください" } }, 400);
  const stayedOnly = c.req.query("stayed") !== "0";
  const db = c.var.db;
  const rows = await db.all<RegistryRow>(
    db
      .prepare(
        `SELECT r.check_in_date, r.check_out_date, r.channel, r.reservation_code, r.checked_out_at,
           g.seq, g.full_name, g.is_japanese, g.nationality, g.passport_number, g.address_country, g.address,
           g.occupation, g.contact, g.is_under16, g.checked_in_at,
           (SELECT file_name FROM photos WHERE id = g.id_photo_id) AS id_file,
           (SELECT file_name FROM photos WHERE id = g.kiosk_photo_id) AS kiosk_file
         FROM reservations r JOIN guests g ON g.reservation_id = r.id
         WHERE r.check_out_date >= ? AND r.check_in_date <= ? AND r.is_test = 0 AND r.status = 'confirmed'
           AND g.status = 'approved' AND (? = 0 OR g.checked_in_at IS NOT NULL)
         ORDER BY r.check_in_date, g.seq LIMIT 2000`,
      )
      .bind(period.from, period.to, stayedOnly ? 1 : 0),
  );

  const header = [
    "チェックイン日",
    "チェックアウト日",
    "予約経路",
    "予約コード",
    "番号",
    "氏名",
    "日本人",
    "国籍",
    "旅券番号",
    "住所（国・地域）",
    "住所",
    "職業",
    "連絡先",
    "16歳未満",
    "チェックイン日時",
    "チェックアウト日時",
    "身分証の写真",
    "当日の写真",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.check_in_date,
        r.check_out_date,
        r.channel === "airbnb" ? "Airbnb" : r.channel === "booking" ? "Booking.com" : "その他",
        r.reservation_code,
        r.seq,
        r.full_name,
        r.is_japanese === null ? "" : r.is_japanese ? "はい" : "いいえ",
        r.nationality,
        r.passport_number,
        r.address_country,
        r.address,
        r.occupation,
        r.contact,
        r.is_under16 ? "はい" : "いいえ",
        jst(r.checked_in_at),
        jst(r.checked_out_at),
        r.id_file,
        r.kiosk_file,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  c.executionCtx.waitUntil(
    db.run(auditStatement(db, `admin:${c.var.admin.email}`, "export_csv", `${period.from}〜${period.to}（${rows.length}人）`)),
  );
  const body = `﻿${lines.join("\r\n")}\r\n`;
  const fileName = `tamahouse-guests_${period.from}_${period.to}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
