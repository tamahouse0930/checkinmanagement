import type { SetupStatus } from "../../shared/api-types";
import type { Db } from "../lib/db";
import { getSettings, type Settings } from "../lib/settings";

/** 有効なタブレットの台数（初期設定の確認用） */
export function deviceCountStatement(db: Db) {
  return db.prepare("SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL");
}

/**
 * 初期設定の各項目が済んでいるか（設計書 4.14）。設定のキャッシュと、iCal の取得元・タブレットの数から決める。
 * 管理者の追加は任意のため、完了の判定（pending）には含めない
 */
export function setupStatus(settings: Settings, icalCount: number, deviceCount: number): SetupStatus {
  const { property } = settings;
  const steps = {
    basic: property.name.trim() !== "" && property.operator_name.trim() !== "" && property.operator_contact.trim() !== "",
    recipients: settings.recipients.length > 0,
    google: settings.googleLink !== null,
    ical: icalCount > 0,
    devices: deviceCount > 0,
    accounts: settings.adminEmails.size > 1,
  };
  const pending = (["basic", "recipients", "google", "ical", "devices"] as const).filter((k) => !steps[k]);
  return { steps, pending };
}

/** 設定と、iCal の取得元・タブレットの数を読んで、初期設定の状態を返す */
export async function loadSetupStatus(db: Db): Promise<{ settings: Settings; status: SetupStatus }> {
  const [sources, devices] = await db.batch([db.prepare("SELECT COUNT(*) AS n FROM ical_sources"), deviceCountStatement(db)]);
  const count = (r: D1Result) => (r.results[0] as { n: number }).n;
  const settings = await getSettings(db);
  return { settings, status: setupStatus(settings, count(sources), count(devices)) };
}
