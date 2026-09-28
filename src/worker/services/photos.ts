import type { Env } from "../env";
import type { Db } from "../lib/db";
import { nowIso } from "../lib/time";
import { deleteFile, ensureReservationFolder, renameFile, uploadFile } from "./google/drive";
import type { GuestRow, ReservationRow } from "./guests";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** 先頭のバイト列で JPEG・PNG・WebP だけを受け付ける（設計書 7.2） */
export function detectImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** ファイル名: 番号_氏名_種類（例: 01_YAMADA-Taro_id.jpg。設計書 3.4） */
export function photoFileName(seq: number, fullName: string | null, kind: "id" | "kiosk", mime: string): string {
  const safe = (fullName ?? "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `${String(seq).padStart(2, "0")}_${safe || "guest"}_${kind}.${EXT[mime] ?? "jpg"}`;
}

/** チェックアウト日から 3 年後（要件定義書 D-01） */
export function deleteAfterFor(checkOutDate: string): string {
  const [y, rest] = [Number(checkOutDate.slice(0, 4)), checkOutDate.slice(4)];
  return `${y + 3}${rest === "-02-29" ? "-03-01" : rest}`;
}

interface PhotoRow {
  id: string;
  drive_file_id: string;
}

/**
 * 身分証の写真を Google ドライブに保存し、宿泊者に紐付ける。前の写真があればドライブからも削除する。
 * 戻り値は写真 ID。宿泊者の行はこの時点で存在している必要がある
 */
export async function saveIdPhoto(
  env: Env,
  db: Db,
  reservation: ReservationRow,
  guest: GuestRow,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const folderId = await ensureReservationFolder(env, db, reservation);
  const fileName = photoFileName(guest.seq, guest.full_name, "id", mime);
  const file = await uploadFile(env, db, folderId, fileName, bytes, mime);
  const photoId = crypto.randomUUID();
  const now = nowIso();

  const old = guest.id_photo_id
    ? await db.first<PhotoRow>(db.prepare("SELECT id, drive_file_id FROM photos WHERE id = ?").bind(guest.id_photo_id))
    : null;

  await db.batch([
    db
      .prepare(
        `INSERT INTO photos (id, reservation_id, guest_id, kind, drive_file_id, drive_folder_id, file_name, size_bytes,
           taken_at, delete_after, created_at) VALUES (?, ?, ?, 'id', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(photoId, reservation.id, guest.id, file.id, folderId, fileName, file.size, now, deleteAfterFor(reservation.check_out_date), now),
    db.prepare("UPDATE guests SET id_photo_id = ?, updated_at = ? WHERE id = ?").bind(photoId, now, guest.id),
    ...(old ? [db.prepare("DELETE FROM photos WHERE id = ?").bind(old.id)] : []),
  ]);
  if (old) await deleteFile(env, db, old.drive_file_id).catch(() => undefined);
  return photoId;
}

/**
 * タブレットで撮った当日の写真を保存する（要件定義書 T-02）。撮り直しはタブレットの確認画面でだけできるので、
 * ここでは上書きしない（すでに撮影済みなら呼び出し側で拒否する）
 */
export async function saveKioskPhoto(
  env: Env,
  db: Db,
  reservation: FolderTargetRow,
  guest: { id: string; seq: number; full_name: string | null },
  bytes: Uint8Array,
  mime: string,
): Promise<{ photoId: string; statements: D1PreparedStatement[] }> {
  const folderId = await ensureReservationFolder(env, db, reservation);
  const fileName = photoFileName(guest.seq, guest.full_name, "kiosk", mime);
  const file = await uploadFile(env, db, folderId, fileName, bytes, mime);
  const photoId = crypto.randomUUID();
  const now = nowIso();
  return {
    photoId,
    statements: [
      db
        .prepare(
          `INSERT INTO photos (id, reservation_id, guest_id, kind, drive_file_id, drive_folder_id, file_name, size_bytes,
             taken_at, delete_after, created_at) VALUES (?, ?, ?, 'kiosk', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(photoId, reservation.id, guest.id, file.id, folderId, fileName, file.size, now, deleteAfterFor(reservation.check_out_date), now),
    ],
  };
}

type FolderTargetRow = Parameters<typeof ensureReservationFolder>[2] & { check_out_date: string };

/** 送信時に、写真のファイル名を入力された氏名に合わせる（撮影時は氏名が未入力のことがあるため） */
export async function renamePhotosForGuests(env: Env, db: Db, guests: GuestRow[]): Promise<void> {
  const ids = guests.map((g) => g.id_photo_id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const photos = await db.all<{ id: string; guest_id: string; drive_file_id: string; file_name: string }>(
    db.prepare(`SELECT id, guest_id, drive_file_id, file_name FROM photos WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids),
  );
  const stmts: D1PreparedStatement[] = [];
  for (const photo of photos) {
    const guest = guests.find((g) => g.id === photo.guest_id);
    if (!guest) continue;
    const ext = photo.file_name.split(".").pop() ?? "jpg";
    const name = photoFileName(guest.seq, guest.full_name, "id", ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
    if (name === photo.file_name) continue;
    await renameFile(env, db, photo.drive_file_id, name);
    stmts.push(db.prepare("UPDATE photos SET file_name = ? WHERE id = ?").bind(name, photo.id));
  }
  if (stmts.length > 0) await db.batch(stmts);
}

/** 宿泊者の写真を削除する（人数を減らしたときなど） */
export async function deletePhotos(env: Env, db: Db, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const photos = await db.all<PhotoRow>(
    db.prepare(`SELECT id, drive_file_id FROM photos WHERE id IN (${photoIds.map(() => "?").join(",")})`).bind(...photoIds),
  );
  for (const p of photos) await deleteFile(env, db, p.drive_file_id).catch(() => undefined);
  await db.run(db.prepare(`DELETE FROM photos WHERE id IN (${photoIds.map(() => "?").join(",")})`).bind(...photoIds));
}
