import type { GuestView } from "./guest";
import type { Lang } from "./langs";
import type { AttentionKey, Channel, ProgressKey, RegStatus, ReservationStatus, StayStatus } from "./progress";

/** カレンダー・一覧に出す予約（宿泊者の個人情報は含めない） */
export interface ReservationSummary {
  id: string;
  channel: Channel;
  source: "ical" | "manual";
  isTest: boolean;
  reservationCode: string | null;
  label: string | null;
  checkInDate: string;
  checkOutDate: string;
  status: ReservationStatus;
  progress: ProgressKey;
  guestTotal: number;
  guestCheckedIn: number;
}

export interface CalendarResponse {
  month: string;
  today: string;
  reservations: ReservationSummary[];
  attention: Record<AttentionKey, number>;
  alerts: string[];
  /** 初期設定で済んでいない項目（空なら完了） */
  setupPending: SetupStepKey[];
}

/** 初期設定の項目（設計書 4.14）。accounts（管理者の追加）は任意 */
export type SetupStepKey = "basic" | "recipients" | "google" | "ical" | "devices" | "accounts";

export interface SetupStatus {
  steps: Record<SetupStepKey, boolean>;
  pending: SetupStepKey[];
}

export interface ReservationDetail extends ReservationSummary {
  phoneLast4: string | null;
  bookerName: string | null;
  note: string | null;
  statusLocked: boolean;
  regStatus: RegStatus;
  stayStatus: StayStatus;
  guestUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lang: Lang | null;
  rejectReason: string | null;
  keyboxCode: string | null;
  inviteSentAt: string | null;
  codeSentAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  consentForCompanions: boolean;
  guestPending: number;
  firstCheckinAt: string | null;
  photosVerifiedAt: string | null;
  photoMismatch: string | null;
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  guests: GuestView[];
  /** 言語ごとの案内文（コピー用。暗証番号・差し戻しは条件がそろったときだけ） */
  messages: {
    invite: Record<Lang, string>;
    code: Record<Lang, string> | null;
    reject: Record<Lang, string> | null;
  };
}

/** 宿泊者入力画面が受け取る内容（同行者の場合は本人の分だけ） */
export interface RegistrationView {
  role: "representative" | "companion";
  property: { name: string; checkinTime: string; checkoutTime: string };
  checkInDate: string;
  checkOutDate: string;
  regStatus: RegStatus;
  rejectReason: string | null;
  guestTotal: number;
  guests: GuestView[];
  companionSeq: number | null;
  houseRules: Record<Lang, string>;
  isTest: boolean;
}

export interface SyncResponse {
  results: { channel: Channel; added: number; updated: number; cancelled: number; error: string | null }[];
}
