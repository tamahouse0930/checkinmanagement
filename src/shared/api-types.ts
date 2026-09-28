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
}

export interface SyncResponse {
  results: { channel: Channel; added: number; updated: number; cancelled: number; error: string | null }[];
}
