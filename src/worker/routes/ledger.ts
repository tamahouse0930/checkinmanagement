import { Hono } from "hono";
import { isValidDate } from "../../shared/dates";
import type { AppEnv } from "../env";
import { auditStatement } from "../lib/audit";

/** 写真台帳（要件定義書 H-33、設計書 4.13）と名簿の CSV 出力（要件定義書 H-30） */
export const ledgerRoutes = new Hono<AppEnv>();

interface LedgerRow {
  photo_id: string;
  kind: "id" | "kiosk";
  file_name: string;
  drive_file_id: string;
  taken_at: string;
  missing_at: string | null;
  reservation_id: string;
  check_in_date: string;
  check_out_date: string;
  channel: string;
  reservation_code: string | null;
  is_test: number;
  seq: number | null;
  full_name: string | null;
}

function range(c: { req: { query: (k: string) => string | undefined } }): { from: string; to: string } | null {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isValidDate(from) || !isValidDate(to) || from > to) return null;
  return { from, to };
}

/**
 * 写真台帳。宿泊日（チェックイン日〜チェックアウト日）が期間に重なる予約の写真を、宿泊者と紐付けて返す。
 * 索引 idx_reservations_checkout で期間の予約に絞り、写真は idx_photos_reservation で引く
 */
ledgerRoutes.get("/photos", async (c) => {
  const period = range(c);
  if (!period) return c.json({ error: { code: "bad_request", message: "期間を指定してください" } }, 400);
  const name = (c.req.query("name") ?? "").trim().slice(0, 50);
  const db = c.var.db;
  const rows = await db.all<LedgerRow>(
    db
      .prepare(
        `SELECT p.id AS photo_id, p.kind, p.file_name, p.drive_file_id, p.taken_at, p.missing_at,
           r.id AS reservation_id, r.check_in_date, r.check_out_date, r.channel, r.reservation_code, r.is_test,
           g.seq, g.full_name
         FROM reservations r
         JOIN photos p ON p.reservation_id = r.id
         LEFT JOIN guests g ON g.id = p.guest_id
         WHERE r.check_out_date >= ? AND r.check_in_date <= ?
           AND (? = '' OR g.full_name LIKE '%' || ? || '%')
         ORDER BY r.check_in_date, g.seq, p.kind LIMIT 500`,
      )
      .bind(period.from, period.to, name, name),
  );
  return c.json({
    photos: rows.map((r) => ({
      photoId: r.photo_id,
      kind: r.kind,
      fileName: r.file_name,
      driveUrl: `https://drive.google.com/file/d/${r.drive_file_id}/view`,
      takenAt: r.taken_at,
      missing: r.missing_at !== null,
      reservationId: r.reservation_id,
      checkInDate: r.check_in_date,
      checkOutDate: r.check_out_date,
      channel: r.channel,
      reservationCode: r.reservation_code,
      isTest: r.is_test === 1,
      seq: r.seq,
      fullName: r.full_name,
    })),
  });
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
