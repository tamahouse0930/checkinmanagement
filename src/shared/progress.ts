import { addDays } from "./dates";

/** 予約の進捗（設計書 3.2）。予約の行の列だけから計算し、宿泊者の行は読まない（設計書 DB-07） */

export type ReservationStatus = "confirmed" | "cancelled" | "blocked";
export type RegStatus = "none" | "in_progress" | "submitted" | "rejected" | "approved";
export type StayStatus = "not_arrived" | "in_house" | "checked_out";
export type Channel = "airbnb" | "booking" | "other";

export interface ProgressInput {
  status: ReservationStatus;
  reg_status: RegStatus;
  stay_status: StayStatus;
  invite_sent_at: string | null;
  code_sent_at: string | null;
  guest_pending: number;
}

export type ProgressKey =
  | "blocked"
  | "cancelled"
  | "url_unsent"
  | "url_sent"
  | "in_progress"
  | "rejected"
  | "pending"
  | "approved"
  | "code_sent"
  | "in_house"
  | "checked_out";

export function progressOf(r: ProgressInput): ProgressKey {
  if (r.status === "blocked") return "blocked";
  if (r.status === "cancelled") return "cancelled";
  if (r.stay_status === "checked_out") return "checked_out";
  if (r.stay_status === "in_house") return "in_house";
  if (r.reg_status === "rejected") return "rejected";
  if (r.reg_status === "submitted" || (r.reg_status === "approved" && r.guest_pending > 0)) return "pending";
  if (r.reg_status === "approved") return r.code_sent_at ? "code_sent" : "approved";
  if (r.reg_status === "in_progress") return "in_progress";
  return r.invite_sent_at ? "url_sent" : "url_unsent";
}

export const PROGRESS_LABEL: Record<ProgressKey, string> = {
  blocked: "ブロック",
  cancelled: "キャンセル",
  url_unsent: "URL未送信",
  url_sent: "URL送信済み",
  in_progress: "入力中",
  rejected: "差し戻し",
  pending: "承認待ち",
  approved: "承認済み（暗証番号未送信）",
  code_sent: "暗証番号送信済み",
  in_house: "滞在中",
  checked_out: "チェックアウト済み",
};

/** 要対応として数える進捗（要件定義書 H-02） */
export const PROGRESS_ATTENTION_KEYS = ["url_unsent", "pending", "rejected", "approved"] as const;
/**
 * 要対応の全項目。unregistered = 明日（以前）チェックインなのに、URL は送ったがゲストが未入力・入力中のまま、
 * verify = 写真の照合待ち、overdue = チェックアウト時刻を過ぎても未操作
 */
export const ATTENTION_KEYS = [...PROGRESS_ATTENTION_KEYS, "unregistered", "verify", "overdue"] as const;
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

export const ATTENTION_LABEL: Record<AttentionKey, string> = {
  url_unsent: "URL未送信",
  pending: "承認待ち",
  rejected: "差し戻し中",
  approved: "暗証番号未送信",
  unregistered: "前日未登録",
  verify: "照合待ち",
  overdue: "チェックアウト未操作",
};

export interface AttentionInput extends ProgressInput {
  check_in_date: string;
  check_out_date: string;
  guest_checked_in: number;
  photos_verified_at: string | null;
}

/** 1 件の予約が該当する要対応の項目 */
export function attentionOf(r: AttentionInput, today: string, nowTime: string, checkoutTime: string): AttentionKey[] {
  const keys: AttentionKey[] = [];
  const progress = progressOf(r);
  if (r.check_out_date >= today && (PROGRESS_ATTENTION_KEYS as readonly string[]).includes(progress)) {
    keys.push(progress as AttentionKey);
  }
  // URL未送信・差し戻し中は上で数えているので、ここでは URL送信済み・入力中だけを数える
  if (r.check_out_date >= today && r.check_in_date <= addDays(today, 1) && (progress === "url_sent" || progress === "in_progress")) {
    keys.push("unregistered");
  }
  if (r.status === "confirmed" && r.guest_checked_in > 0 && !r.photos_verified_at) keys.push("verify");
  if (r.stay_status === "in_house" && (r.check_out_date < today || (r.check_out_date === today && nowTime >= checkoutTime))) {
    keys.push("overdue");
  }
  return keys;
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  other: "その他",
};
