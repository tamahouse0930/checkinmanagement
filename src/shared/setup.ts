import type { SetupStepKey } from "./api-types";

/** 初期設定の項目の順番と名前（設計書 4.14）。画面と案内メールの両方で使う */
export const SETUP_STEPS: { key: SetupStepKey; label: string }[] = [
  { key: "basic", label: "施設の基本情報" },
  { key: "recipients", label: "通知メールの宛先" },
  { key: "google", label: "Google との連携" },
  { key: "ical", label: "予約の取り込み（iCal）" },
];

export function setupLabel(key: SetupStepKey): string {
  return SETUP_STEPS.find((s) => s.key === key)?.label ?? key;
}

/**
 * ログイン後に戻る管理画面のパス（施設の管理画面 /admin、システム管理 /system）。
 * 外部のサイトへ移されないよう、管理画面の中の決まった形だけを受け付ける
 */
export function safeAdminPath(path: string | null | undefined): string | null {
  return path && /^\/(admin|system)(\/[A-Za-z0-9_-]+)*$/.test(path) ? path : null;
}
