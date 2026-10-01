import { isValidDate } from "./dates";

/** 宿泊者名簿の項目と入力チェック（要件定義書 6 章）。画面と Worker で同じルールを使う */

export type GuestStatus = "draft" | "ready" | "submitted" | "approved";
export type PassportCheck = "match" | "mismatch" | "unreadable";
export type EnteredBy = "representative" | "self" | "admin";

export interface GuestFields {
  isJapanese: boolean | null;
  fullName: string;
  addressCountry: string;
  address: string;
  occupation: string;
  contact: string;
  nationality: string;
  passportNumber: string;
  /** 生年月日（YYYY-MM-DD。未入力は空文字）。16 歳未満かどうかはここから決める（要件定義書 G-15） */
  birthDate: string;
  idPhotoId: string | null;
}

export interface GuestView extends GuestFields {
  /** チェックイン日の時点で 16 歳未満か（保存したときに生年月日から計算した値） */
  isUnder16: boolean;
  id: string;
  seq: number;
  status: GuestStatus;
  enteredBy: EnteredBy;
  entryUrl: string | null;
  consented: boolean;
  /** 写真（MRZ）から読み取った旅券番号と、入力された番号との照合の結果（要件定義書 G-16） */
  passportMrzNumber: string | null;
  passportCheck: PassportCheck | null;
  /** 当日のタブレットの写真とチェックインの日時（管理画面だけで使う） */
  kioskPhotoId: string | null;
  checkedInAt: string | null;
}

export const EMPTY_GUEST: GuestFields = {
  isJapanese: null,
  fullName: "",
  addressCountry: "",
  address: "",
  occupation: "",
  contact: "",
  nationality: "",
  passportNumber: "",
  birthDate: "",
  idPhotoId: null,
};

export const PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/;
export const LIMITS = { fullName: 100, address: 300, occupation: 100, contact: 100 } as const;

export type MissingField =
  | "isJapanese"
  | "fullName"
  | "birthDate"
  | "addressCountry"
  | "address"
  | "occupation"
  | "contact"
  | "nationality"
  | "passportNumber"
  | "idPhoto";

/** date の時点の満年齢（日付は YYYY-MM-DD） */
export function ageOn(birthDate: string, date: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** 生年月日として正しいか。チェックイン日より後の日付と、その 120 年より前は受け付けない */
export function isValidBirthDate(birthDate: string, checkInDate: string): boolean {
  return isValidDate(birthDate) && birthDate <= checkInDate && ageOn(birthDate, checkInDate) <= 120;
}

/** チェックイン日の時点で 16 歳未満か。生年月日が正しくなければ false */
export function isUnder16(birthDate: string, checkInDate: string): boolean {
  return isValidBirthDate(birthDate, checkInDate) && ageOn(birthDate, checkInDate) < 16;
}

/**
 * 管理画面での生年月日の表示（例: 1990/04/11（36 歳））。年齢はチェックイン日の時点。
 * 生年月日を入れる前に登録された宿泊者は、保存されている「16 歳未満」の値を添える
 */
export function birthDateLabel(birthDate: string | null, checkInDate: string, under16: boolean): string {
  if (!birthDate) return under16 ? "未入力（16 歳未満）" : "未入力";
  const age = ageOn(birthDate, checkInDate);
  return `${birthDate.replace(/-/g, "/")}（${age} 歳${age < 16 ? "・16 歳未満" : ""}）`;
}

/** 必須項目のうち、足りないものを返す（空なら入力済み）。16 歳未満の判定にチェックイン日を使う */
export function missingFields(g: GuestFields, checkInDate: string): MissingField[] {
  const missing: MissingField[] = [];
  if (g.isJapanese === null) return ["isJapanese"];
  if (!g.fullName.trim()) missing.push("fullName");
  if (!isValidBirthDate(g.birthDate, checkInDate)) missing.push("birthDate");
  if (!g.addressCountry) missing.push("addressCountry");
  if (!g.address.trim()) missing.push("address");
  if (!g.occupation.trim()) missing.push("occupation");
  if (!g.contact.trim()) missing.push("contact");
  if (!g.isJapanese) {
    if (!g.nationality) missing.push("nationality");
    if (!PASSPORT_PATTERN.test(g.passportNumber)) missing.push("passportNumber");
  }
  // 16 歳未満の日本人だけ、身分証の写真を省略できる（要件定義書 G-15）
  const photoRequired = !(g.isJapanese && isUnder16(g.birthDate, checkInDate));
  if (photoRequired && !g.idPhotoId) missing.push("idPhoto");
  return missing;
}

/** 入力値の正規化（前後の空白、パスポート番号の大文字化、日本人の国籍） */
export function normalizeGuest(g: GuestFields): GuestFields {
  const japanese = g.isJapanese === true;
  return {
    ...g,
    fullName: g.fullName.trim().slice(0, LIMITS.fullName),
    address: g.address.trim().slice(0, LIMITS.address),
    occupation: g.occupation.trim().slice(0, LIMITS.occupation),
    contact: g.contact.trim().slice(0, LIMITS.contact),
    birthDate: g.birthDate.trim(),
    nationality: japanese ? "JP" : g.nationality,
    passportNumber: japanese ? "" : g.passportNumber.replace(/\s/g, "").toUpperCase().slice(0, 12),
  };
}
