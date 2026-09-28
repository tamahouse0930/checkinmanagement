import type { Env } from "../../env";
import type { Db } from "../../lib/db";
import { nowIso } from "../../lib/time";
import { getSettings, invalidateSettings, PROPERTY_ID } from "../../lib/settings";
import { getGoogleAccessToken } from "./token";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
export const ROOT_FOLDER_NAME = "TAMAHOUSE宿泊者写真";

async function createFolder(token: string, name: string, parentId?: string): Promise<string> {
  const res = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Google ドライブにフォルダを作れませんでした（HTTP ${res.status}）`);
  return ((await res.json()) as { id: string }).id;
}

/** 写真の保存先のフォルダ（設計書 3.4）がなければ作り、ID を返す */
export async function ensureRootFolder(env: Env, db: Db): Promise<string> {
  const { property } = await getSettings(db);
  if (property.drive_root_folder_id) return property.drive_root_folder_id;

  const token = await getGoogleAccessToken(env, db);
  const folderId = await createFolder(token, ROOT_FOLDER_NAME);
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
