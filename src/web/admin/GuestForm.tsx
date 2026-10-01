import { useState, type FormEvent } from "react";
import { ageOn, EMPTY_GUEST, type GuestFields, isValidBirthDate, missingFields, normalizeGuest } from "../../shared/guest";
import { CountrySelect } from "../registration/CountrySelect";

const MISSING_LABEL: Record<string, string> = {
  isJapanese: "日本人かどうか",
  fullName: "氏名",
  birthDate: "生年月日",
  addressCountry: "住所（国・地域）",
  address: "住所",
  occupation: "職業",
  contact: "連絡先",
  nationality: "国籍",
  passportNumber: "パスポート番号",
  idPhoto: "身分証の写真",
};

/** 管理者が宿泊者の項目を修正・追加するフォーム（要件定義書 H-15） */
export function GuestForm(props: {
  initial?: GuestFields;
  /** 16 歳未満かどうかは、チェックイン日の時点の年齢で決める */
  checkInDate: string;
  submitLabel: string;
  withReason?: boolean;
  onSubmit: (fields: Omit<GuestFields, "idPhotoId">, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [g, setG] = useState<GuestFields>(props.initial ?? { ...EMPTY_GUEST, isJapanese: true, addressCountry: "JP" });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof GuestFields>(key: K, value: GuestFields[K]) => setG((prev) => ({ ...prev, [key]: value }));
  // 写真は別の操作で扱うので、ここでは写真以外の未入力だけを知らせる
  const missing = missingFields(normalizeGuest({ ...g, idPhotoId: "x" }), props.checkInDate);
  const age = isValidBirthDate(g.birthDate, props.checkInDate) ? ageOn(g.birthDate, props.checkInDate) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { idPhotoId: _photo, ...fields } = g;
      await props.onSubmit(fields, reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form className="form guest-admin-form" onSubmit={submit}>
      <div className="row">
        <label>
          日本人
          <select value={g.isJapanese === null ? "" : g.isJapanese ? "1" : "0"} onChange={(e) => set("isJapanese", e.target.value === "" ? null : e.target.value === "1")}>
            <option value="">—</option>
            <option value="1">はい</option>
            <option value="0">いいえ</option>
          </select>
        </label>
        <label>
          生年月日{age !== null && `（チェックイン日に ${age} 歳）`}
          <input type="date" value={g.birthDate} min="1900-01-01" max={props.checkInDate} onChange={(e) => set("birthDate", e.target.value)} />
        </label>
      </div>
      <label>
        氏名
        <input value={g.fullName} onChange={(e) => set("fullName", e.target.value)} maxLength={100} />
      </label>
      {g.isJapanese === false && (
        <div className="row">
          <label>
            国籍
            <CountrySelect lang="ja" value={g.nationality} placeholder="選択してください" onChange={(v) => set("nationality", v)} />
          </label>
          <label>
            パスポート番号
            <input value={g.passportNumber} onChange={(e) => set("passportNumber", e.target.value.toUpperCase())} maxLength={12} />
          </label>
        </div>
      )}
      <label>
        住所（国・地域）
        <CountrySelect lang="ja" value={g.addressCountry} placeholder="選択してください" onChange={(v) => set("addressCountry", v)} pinned={["JP"]} />
      </label>
      <label>
        住所
        <textarea value={g.address} onChange={(e) => set("address", e.target.value)} maxLength={300} rows={2} />
      </label>
      <div className="row">
        <label>
          職業
          <input value={g.occupation} onChange={(e) => set("occupation", e.target.value)} maxLength={100} />
        </label>
        <label>
          連絡先
          <input value={g.contact} onChange={(e) => set("contact", e.target.value)} maxLength={100} />
        </label>
      </div>
      {props.withReason && (
        <label>
          修正の理由（任意。記録に残ります）
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      )}
      {missing.length > 0 && <p className="note warn-text">未入力: {missing.map((m) => MISSING_LABEL[m] ?? m).join("、")}</p>}
      {error && <p className="alert">{error}</p>}
      <div className="actions">
        <button className="button primary" type="submit" disabled={saving}>
          {props.submitLabel}
        </button>
        <button className="button" type="button" onClick={props.onCancel} disabled={saving}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
