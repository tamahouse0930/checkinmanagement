import { type EnteredBy, type GuestFields, type GuestStatus, type GuestView, isUnder16, missingFields, normalizeGuest, type PassportCheck } from "../../shared/guest";
import { samePassportNumber } from "../../shared/mrz";
import type { Channel, RegStatus, ReservationStatus, StayStatus } from "../../shared/progress";
import type { Db } from "../lib/db";

export interface ReservationRow {
  id: string;
  channel: Channel;
  source: "ical" | "manual";
  is_test: number;
  reservation_code: string | null;
  phone_last4: string | null;
  booker_name: string | null;
  display_name: string | null;
  note: string | null;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
  status_locked: number;
  guest_token: string | null;
  reg_status: RegStatus;
  stay_status: StayStatus;
  lang: string | null;
  reject_reason: string | null;
  keybox_code: string | null;
  consent_at: string | null;
  consent_for_companions: number;
  invite_sent_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  code_sent_at: string | null;
  guest_total: number;
  guest_ready: number;
  guest_pending: number;
  guest_checked_in: number;
  drive_folder_id: string | null;
  first_checkin_at: string | null;
  photos_verified_at: string | null;
  photo_mismatch: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  notified_unregistered_at: string | null;
  notified_overdue_at: string | null;
  /** 玄関のタブレットから登録を始めた（送信したら自動で承認する。要件定義書 T-11） */
  kiosk_registration: number;
  created_at: string;
  updated_at: string;
}

export interface GuestRow {
  id: string;
  reservation_id: string;
  seq: number;
  status: GuestStatus;
  entry_token: string | null;
  entered_by: EnteredBy;
  is_japanese: number | null;
  full_name: string | null;
  address_country: string | null;
  address: string | null;
  occupation: string | null;
  contact: string | null;
  nationality: string | null;
  passport_number: string | null;
  is_under16: number;
  birth_date: string | null;
  id_photo_id: string | null;
  passport_mrz_number: string | null;
  passport_check: PassportCheck | null;
  consent_at: string | null;
  approved_at: string | null;
  kiosk_photo_id: string | null;
  checked_in_at: string | null;
}

export function toFields(row: GuestRow | null): GuestFields {
  return {
    isJapanese: row?.is_japanese === null || row?.is_japanese === undefined ? null : row.is_japanese === 1,
    fullName: row?.full_name ?? "",
    addressCountry: row?.address_country ?? "",
    address: row?.address ?? "",
    occupation: row?.occupation ?? "",
    contact: row?.contact ?? "",
    nationality: row?.nationality ?? "",
    passportNumber: row?.passport_number ?? "",
    birthDate: row?.birth_date ?? "",
    idPhotoId: row?.id_photo_id ?? null,
  };
}

export function toView(row: GuestRow, origin: string): GuestView {
  return {
    ...toFields(row),
    isUnder16: row.is_under16 === 1,
    id: row.id,
    seq: row.seq,
    status: row.status,
    enteredBy: row.entered_by,
    entryUrl: row.entry_token ? `${origin}/g/${row.entry_token}` : null,
    consented: row.consent_at !== null,
    passportMrzNumber: row.passport_mrz_number,
    passportCheck: row.passport_check,
    kioskPhotoId: row.kiosk_photo_id,
    checkedInAt: row.checked_in_at,
  };
}

/** 入力済みかどうか。同行者が自分で入力した場合は本人の同意も必要（要件定義書 G-18） */
export function statusFor(fields: GuestFields, checkInDate: string, needsOwnConsent: boolean, consented: boolean): "draft" | "ready" {
  return missingFields(fields, checkInDate).length === 0 && (!needsOwnConsent || consented) ? "ready" : "draft";
}

/**
 * 写真から読み取った番号と、入力された番号の照合（要件定義書 G-16）。
 * 日本人は対象外。読み取った番号があれば一致／不一致、読み取りを試して読めなかった場合は「読み取れず」
 */
export function passportCheckFor(fields: GuestFields, mrzNumber: string | null, ocrTried: boolean): PassportCheck | null {
  if (fields.isJapanese !== false) return null;
  if (mrzNumber) return samePassportNumber(fields.passportNumber, mrzNumber) ? "match" : "mismatch";
  return ocrTried && fields.idPhotoId ? "unreadable" : null;
}

/**
 * 16 歳未満かどうかを DB に保存する値。生年月日があればチェックイン日の時点の年齢から計算し、
 * ない場合（生年月日を入れる前に登録された宿泊者）は今の値を残す
 */
export function under16Value(birthDate: string, checkInDate: string, current: number): number {
  return birthDate ? (isUnder16(birthDate, checkInDate) ? 1 : 0) : current;
}

/** 1 人分の行を登録または更新する SQL（予約と番号で一意） */
export function upsertGuestStatement(
  db: Db,
  reservation: Pick<ReservationRow, "id" | "check_in_date">,
  seq: number,
  fields: GuestFields,
  status: GuestStatus,
  enteredBy: EnteredBy,
  consentAt: string | null,
  now: string,
  passport: { mrzNumber: string | null; check: PassportCheck | null } = { mrzNumber: null, check: null },
): D1PreparedStatement {
  const g = normalizeGuest(fields);
  return db
    .prepare(
      `INSERT INTO guests (id, reservation_id, seq, status, entered_by, is_japanese, full_name, address_country, address,
         occupation, contact, nationality, passport_number, is_under16, birth_date, id_photo_id, consent_at, passport_mrz_number,
         passport_check, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (reservation_id, seq) DO UPDATE SET status = excluded.status, entered_by = excluded.entered_by,
         is_japanese = excluded.is_japanese, full_name = excluded.full_name, address_country = excluded.address_country,
         address = excluded.address, occupation = excluded.occupation, contact = excluded.contact,
         nationality = excluded.nationality, passport_number = excluded.passport_number, is_under16 = CASE WHEN excluded.birth_date IS NULL THEN guests.is_under16 ELSE excluded.is_under16 END,
         birth_date = excluded.birth_date,
         id_photo_id = excluded.id_photo_id, consent_at = excluded.consent_at,
         passport_mrz_number = excluded.passport_mrz_number, passport_check = excluded.passport_check,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      reservation.id,
      seq,
      status,
      enteredBy,
      g.isJapanese === null ? null : g.isJapanese ? 1 : 0,
      g.fullName || null,
      g.addressCountry || null,
      g.address || null,
      g.occupation || null,
      g.contact || null,
      g.nationality || null,
      g.passportNumber || null,
      under16Value(g.birthDate, reservation.check_in_date, 0),
      g.birthDate || null,
      g.idPhotoId,
      consentAt,
      passport.mrzNumber,
      passport.check,
      now,
      now,
    );
}

/**
 * 予約の集計値を宿泊者の行から計算し直す SQL（設計書 DB-07）。宿泊者を書き換える一括実行の最後に入れる。
 * 宿泊者は (reservation_id, seq) の一意制約の索引で数えるので、読むのはその予約の宿泊者だけ
 */
export function countersStatement(db: Db, reservationId: string, now: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE reservations SET
         guest_ready = (SELECT COUNT(*) FROM guests WHERE reservation_id = ?1 AND status <> 'draft'),
         guest_pending = (SELECT COUNT(*) FROM guests WHERE reservation_id = ?1 AND status = 'submitted'),
         guest_checked_in = (SELECT COUNT(*) FROM guests WHERE reservation_id = ?1 AND checked_in_at IS NOT NULL),
         display_name = (SELECT full_name FROM guests WHERE reservation_id = ?1 AND seq = 1),
         updated_at = ?2
       WHERE id = ?1`,
    )
    .bind(reservationId, now);
}

export async function loadGuests(db: Db, reservationId: string): Promise<GuestRow[]> {
  return db.all<GuestRow>(
    db.prepare("SELECT * FROM guests WHERE reservation_id = ? ORDER BY seq LIMIT 50").bind(reservationId),
  );
}
