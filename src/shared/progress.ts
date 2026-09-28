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
export const ATTENTION_KEYS = ["url_unsent", "pending", "rejected", "approved"] as const;
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

export const ATTENTION_LABEL: Record<AttentionKey, string> = {
  url_unsent: "URL未送信",
  pending: "承認待ち",
  rejected: "差し戻し中",
  approved: "暗証番号未送信",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  other: "その他",
};
