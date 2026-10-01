import type { SetupStepKey } from "./api-types";

/** 初期設定の項目の順番と名前（設計書 4.14）。画面と案内メールの両方で使う */
export const SETUP_STEPS: { key: SetupStepKey; label: string; optional?: boolean }[] = [
  { key: "basic", label: "施設の基本情報" },
  { key: "recipients", label: "通知メールの宛先" },
  { key: "google", label: "Google との連携" },
  { key: "ical", label: "予約の取り込み（iCal）" },
  { key: "devices", label: "チェックイン用タブレットの登録" },
  { key: "accounts", label: "管理者の追加", optional: true },
];

export function setupLabel(key: SetupStepKey): string {
  return SETUP_STEPS.find((s) => s.key === key)?.label ?? key;
}

/**
 * ログイン後に戻る管理画面のパス。外部のサイトへ移されないよう、管理画面の中の決まった形だけを受け付ける
 */
export function safeAdminPath(path: string | null | undefined): string | null {
  return path && /^\/admin(\/[A-Za-z0-9_-]+)*$/.test(path) ? path : null;
}
