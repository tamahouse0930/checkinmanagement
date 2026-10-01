import type { SetupStatus } from "../../shared/api-types";
import type { Db } from "../lib/db";
import { getSettings, type Settings } from "../lib/settings";

/**
 * 初期設定の各項目が済んでいるか（設計書 4.14）。設定のキャッシュと、iCal の取得元の数から決める
 */
export function setupStatus(settings: Settings, icalCount: number): SetupStatus {
  const { property } = settings;
  const steps = {
    basic: property.name.trim() !== "" && property.operator_name.trim() !== "" && property.operator_contact.trim() !== "",
    recipients: settings.recipients.length > 0,
    google: settings.googleLink !== null,
    ical: icalCount > 0,
  };
  const pending = (["basic", "recipients", "google", "ical"] as const).filter((k) => !steps[k]);
  return { steps, pending };
}

/** 設定と、iCal の取得元の数を読んで、初期設定の状態を返す */
export async function loadSetupStatus(db: Db): Promise<{ settings: Settings; status: SetupStatus }> {
  const sources = await db.first<{ n: number }>(db.prepare("SELECT COUNT(*) AS n FROM ical_sources"));
  const settings = await getSettings(db);
  return { settings, status: setupStatus(settings, sources?.n ?? 0) };
}
