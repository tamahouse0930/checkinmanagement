import type { Env } from "../../env";
import type { Db } from "../../lib/db";
import { nowIso } from "../../lib/time";
import { getSettings, invalidateSettings, PROPERTY_ID } from "../../lib/settings";
import { getGoogleAccessToken } from "./token";

/** Google ドライブの操作（設計書 3.4）。権限は drive.file（このアプリが作ったファイルだけ）なので、他のファイルには触れない */

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** 写真の保存先のフォルダの名前。作るときの施設名を使い、後で施設名を変えてもフォルダは ID で探すため影響しない */
export function rootFolderName(propertyName: string): string {
  return `${propertyName}宿泊者写真`;
}

export class DriveError extends Error {}

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok && res.status !== 404) throw new DriveError(`Google ドライブの操作に失敗しました（HTTP ${res.status}）`);
  return res;
}

async function createFolder(token: string, name: string, parentId?: string): Promise<string> {
  const res = await driveFetch(token, `${DRIVE_FILES}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const res = await driveFetch(token, `${DRIVE_FILES}?fields=files(id)&pageSize=1&q=${encodeURIComponent(q)}`);
  const found = ((await res.json()) as { files?: { id: string }[] }).files?.[0];
  return found?.id ?? createFolder(token, name, parentId);
}

/** 写真の保存先のフォルダ（例: TAMAHOUSE宿泊者写真）がなければ作り、ID を返す */
export async function ensureRootFolder(env: Env, db: Db): Promise<string> {
  const { property } = await getSettings(db);
  if (property.drive_root_folder_id) return property.drive_root_folder_id;

  const token = await getGoogleAccessToken(env, db);
  const folderId = await createFolder(token, rootFolderName(property.name));
  await db.run(
    db
      .prepare(
        "UPDATE properties SET drive_root_folder_id = ?, settings_version = settings_version + 1, updated_at = ? WHERE id = ?",
      )
      .bind(folderId, nowIso(), PROPERTY_ID),
  );
  invalidateSettings();
  return folderId;
}

export interface FolderTarget {
  id: string;
  is_test: number;
  check_in_date: string;
  channel: string;
  reservation_code: string | null;
  drive_folder_id: string | null;
}

const CHANNEL_NAME: Record<string, string> = { airbnb: "Airbnb", booking: "Booking", other: "Other" };

/** 宿泊ごとのフォルダ（例: 2026/2026-10-03_Airbnb_HMABCD1234。テスト予約は _test の下）を用意する */
export async function ensureReservationFolder(env: Env, db: Db, r: FolderTarget): Promise<string> {
  if (r.drive_folder_id) return r.drive_folder_id;
  const root = await ensureRootFolder(env, db);
  const token = await getGoogleAccessToken(env, db);
  const parent = await findOrCreateFolder(token, r.is_test ? "_test" : r.check_in_date.slice(0, 4), root);
  const name = `${r.check_in_date}_${CHANNEL_NAME[r.channel] ?? r.channel}_${r.reservation_code ?? r.id.slice(0, 5)}`;
  const folderId = await createFolder(token, name, parent);
  await db.run(db.prepare("UPDATE reservations SET drive_folder_id = ? WHERE id = ?").bind(folderId, r.id));
  return folderId;
}

export async function uploadFile(
  env: Env,
  db: Db,
  folderId: string,
  name: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ id: string; size: number }> {
  const token = await getGoogleAccessToken(env, db);
  const boundary = `th${crypto.randomUUID().replace(/-/g, "")}`;
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [folderId] }) +
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await driveFetch(token, `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,size`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = (await res.json()) as { id: string; size?: string };
  return { id: file.id, size: Number(file.size ?? bytes.length) };
}

export async function renameFile(env: Env, db: Db, fileId: string, name: string): Promise<void> {
  const token = await getGoogleAccessToken(env, db);
  await driveFetch(token, `${DRIVE_FILES}/${fileId}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** ファイルを削除する（すでにない場合は何もしない） */
export async function deleteFile(env: Env, db: Db, fileId: string): Promise<void> {
  const token = await getGoogleAccessToken(env, db);
  await driveFetch(token, `${DRIVE_FILES}/${fileId}`, { method: "DELETE" });
}

/**
 * このアプリが作った写真のファイル ID の一覧（フォルダを除く）。権限が drive.file なので、
 * 管理者が自分で置いた他のファイルは含まれない。1 回で最大 1,000 件、最大 5 回まで取得する
 */
export async function listAppFileIds(env: Env, db: Db): Promise<Set<string>> {
  const token = await getGoogleAccessToken(env, db);
  const ids = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      q: `mimeType != '${FOLDER_MIME}' and trashed = false`,
      fields: "nextPageToken, files(id)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(token, `${DRIVE_FILES}?${params}`);
    const body = (await res.json()) as { nextPageToken?: string; files?: { id: string }[] };
    for (const f of body.files ?? []) ids.add(f.id);
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

/**
 * 画像の文字を Google ドライブの文字認識（OCR）で読み取る（要件定義書 G-16）。画像を Google ドキュメントに
 * 変換してコピーし（このとき文字認識される）、中の文字を取り出してからコピーを削除する。
 * 読み取りはすべて Google 側で行うので、ゲストのスマホにも Worker の CPU 時間にも負担をかけない。
 * 画像が見つからなければ null
 */
export async function ocrImage(env: Env, db: Db, fileId: string): Promise<string | null> {
  const token = await getGoogleAccessToken(env, db);
  const copy = await driveFetch(token, `${DRIVE_FILES}/${fileId}/copy?ocrLanguage=en&fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `_ocr_${fileId}`, mimeType: "application/vnd.google-apps.document" }),
  });
  if (copy.status === 404) return null;
  const docId = ((await copy.json()) as { id: string }).id;
  try {
    const res = await driveFetch(token, `${DRIVE_FILES}/${docId}/export?mimeType=text/plain`);
    return res.status === 404 ? null : await res.text();
  } finally {
    // 削除に失敗しても、コピーは宿泊ごとのフォルダの中にあるため、保存期間が過ぎればフォルダごと消える
    await driveFetch(token, `${DRIVE_FILES}/${docId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

/** ファイルの中身を取得する。見つからなければ null */
export async function downloadFile(env: Env, db: Db, fileId: string): Promise<Response | null> {
  const token = await getGoogleAccessToken(env, db);
  const res = await driveFetch(token, `${DRIVE_FILES}/${fileId}?alt=media`);
  return res.status === 404 ? null : res;
}
