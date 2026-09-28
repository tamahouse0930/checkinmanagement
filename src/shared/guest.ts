/** 宿泊者名簿の項目と入力チェック（要件定義書 6 章）。画面と Worker で同じルールを使う */

export type GuestStatus = "draft" | "ready" | "submitted" | "approved";
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
  isUnder16: boolean;
  idPhotoId: string | null;
}

export interface GuestView extends GuestFields {
  seq: number;
  status: GuestStatus;
  enteredBy: EnteredBy;
  entryUrl: string | null;
  consented: boolean;
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
  isUnder16: false,
  idPhotoId: null,
};

export const PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/;
export const LIMITS = { fullName: 100, address: 300, occupation: 100, contact: 100 } as const;

export type MissingField =
  | "isJapanese"
  | "fullName"
  | "addressCountry"
  | "address"
  | "occupation"
  | "contact"
  | "nationality"
  | "passportNumber"
  | "idPhoto";

/** 必須項目のうち、足りないものを返す（空なら入力済み） */
export function missingFields(g: GuestFields): MissingField[] {
  const missing: MissingField[] = [];
  if (g.isJapanese === null) return ["isJapanese"];
  if (!g.fullName.trim()) missing.push("fullName");
  if (!g.addressCountry) missing.push("addressCountry");
  if (!g.address.trim()) missing.push("address");
  if (!g.occupation.trim()) missing.push("occupation");
  if (!g.contact.trim()) missing.push("contact");
  if (!g.isJapanese) {
    if (!g.nationality) missing.push("nationality");
    if (!PASSPORT_PATTERN.test(g.passportNumber)) missing.push("passportNumber");
  }
  // 16 歳未満の日本人だけ、身分証の写真を省略できる（要件定義書 G-15）
  const photoRequired = !(g.isJapanese && g.isUnder16);
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
    nationality: japanese ? "JP" : g.nationality,
    passportNumber: japanese ? "" : g.passportNumber.replace(/\s/g, "").toUpperCase().slice(0, 12),
  };
}
