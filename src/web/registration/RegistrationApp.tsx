import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RegistrationView } from "../../shared/api-types";
import { diffDays } from "../../shared/dates";
import { EMPTY_GUEST, type GuestFields, type GuestView, isUnder16, type MissingField, missingFields, normalizeGuest } from "../../shared/guest";
import { detectLang, isLang, LANG_NAME, LANGS, type Lang } from "../../shared/langs";
import { fill, GUEST_TEXT, type GuestText } from "../i18n/guest";
import { BirthDateSelect } from "./BirthDateSelect";
import { CountrySelect } from "./CountrySelect";
import { IdCamera } from "./IdCamera";
import { PrivacyLink } from "./PrivacyDialog";
import { alpha3ToAlpha2, type MrzResult } from "../../shared/mrz";
import { resizeImage } from "./photo";
import { useDocumentTitle } from "../lib/title";

/** 宿泊者入力画面（代表者 /r/:token、同行者 /g/:token。設計書 4.3） */

class RegError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type LoadPhoto = (photoId: string) => Promise<Blob | null>;

function useLoadPhoto(base: "/api/r" | "/api/g", token: string): LoadPhoto {
  return useCallback(
    (photoId: string) =>
      fetch(`${base}/photos/${encodeURIComponent(photoId)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.blob() : null))
        .catch(() => null),
    [base, token],
  );
}

function useApi(base: "/api/r" | "/api/g", token: string) {
  return useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      let body: BodyInit | undefined;
      if (init?.form) body = init.form;
      else if (init?.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(init.body);
      }
      const res = await fetch(`${base}${path}`, { method: init?.method ?? "GET", headers, body });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new RegError(res.status, data?.error?.code ?? "error");
      return data as T;
    },
    [base, token],
  );
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("th_lang");
    if (isLang(saved)) return saved;
  } catch {
    // 保存できない環境では毎回ブラウザの言語設定から選ぶ
  }
  return detectLang(navigator.languages ?? [navigator.language]);
}

function formatDate(date: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function guestLabel(g: GuestView | undefined, t: GuestText): string {
  if (!g) return t.notEntered;
  if (g.status === "approved") return t.approved;
  if (g.status === "ready" || g.status === "submitted") return t.entered;
  return g.fullName || g.idPhotoId || g.isJapanese !== null ? t.inProgress : t.notEntered;
}

const MISSING_KEY: Record<MissingField, keyof GuestText> = {
  isJapanese: "isJapanese",
  fullName: "fullName",
  birthDate: "birthDate",
  addressCountry: "addressCountry",
  address: "address",
  occupation: "occupation",
  contact: "contact",
  nationality: "nationality",
  passportNumber: "passportNumber",
  idPhoto: "idPhotoLabel",
};

// ---- 写真 ----

function PhotoField(props: {
  t: GuestText;
  api: ReturnType<typeof useApi>;
  loadPhoto: LoadPhoto;
  uploadPath: string;
  photoId: string | null;
  disabled: boolean;
  /** 玄関のタブレットでは、ファイルの選択ではなく前面のカメラを画面の中で起動する（タブレットを動かせないため） */
  useCamera: boolean;
  onUploaded: (photoId: string) => void;
}) {
  const { t, api } = props;
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [state, setState] = useState<"idle" | "uploading" | "saved" | "failed">("idle");
  const input = useRef<HTMLInputElement>(null);

  // 保存済みの写真を表示する（トークンをヘッダーで送るため、取得してから画像にする）
  useEffect(() => {
    if (!props.photoId || preview) return;
    let url: string | null = null;
    props.loadPhoto(props.photoId).then((blob) => {
      if (blob) {
        url = URL.createObjectURL(blob);
        setPreview(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [props.photoId]);

  const onFile = async (file: Blob | undefined) => {
    if (!file) return;
    setState("uploading");
    try {
      const resized = await resizeImage(file);
      setPreview(URL.createObjectURL(resized));
      const form = new FormData();
      form.append("file", resized, "photo.jpg");
      const res = await api<{ photoId: string }>(props.uploadPath, { method: "POST", form });
      setState("saved");
      props.onUploaded(res.photoId);
    } catch {
      setState("failed");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="photo-field">
      {preview && <img src={preview} alt="" className="photo-preview" />}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {!props.disabled && (
        <button
          type="button"
          className="button"
          onClick={() => (props.useCamera ? setCameraOpen(true) : input.current?.click())}
          disabled={state === "uploading"}
        >
          {state === "uploading" ? t.uploading : props.photoId || preview ? t.retakePhoto : t.takePhoto}
        </button>
      )}
      {cameraOpen && (
        <IdCamera
          t={t}
          onClose={() => setCameraOpen(false)}
          onCaptured={(blob) => {
            setCameraOpen(false);
            void onFile(blob);
          }}
        />
      )}
      {state === "saved" && <p className="notice">{t.photoSaved}</p>}
      {state === "failed" && <p className="alert">{t.photoFailed}</p>}
    </div>
  );
}

// ---- 1 人分の入力 ----

function GuestEditor(props: {
  t: GuestText;
  lang: Lang;
  api: ReturnType<typeof useApi>;
  loadPhoto: LoadPhoto;
  role: RegistrationView["role"];
  seq: number;
  guest: GuestView | undefined;
  representative: GuestView | undefined;
  /** 16 歳未満かどうかは、チェックイン日の時点の年齢で決める */
  checkInDate: string;
  readOnly: boolean;
  /** 玄関のタブレットで入力している（身分証は前面のカメラで撮る） */
  kiosk: boolean;
  onSaved: () => Promise<void>;
  onBack: () => void;
}) {
  const { t, lang, api, seq, representative, checkInDate } = props;
  const isCompanion = props.role === "companion";
  const [g, setG] = useState<GuestFields>(() => {
    const base = props.guest ? { ...props.guest } : { ...EMPTY_GUEST };
    // 2 人目以降は、代表者と同じ答え・国籍を初期値にする。住所・連絡先は「代表者と同じ」にチェックしたときだけ写す（要件定義書 G-17）
    if (seq > 1 && representative && !props.guest?.fullName) {
      if (base.isJapanese === null) base.isJapanese = representative.isJapanese;
      if (!base.nationality && representative.isJapanese === false) base.nationality = representative.nationality;
    }
    return base;
  });
  /** 「代表者と同じ」のチェック。初期値は外す。保存済みで代表者と同じ値なら付けておく */
  const [sameAddress, setSameAddress] = useState(
    () =>
      seq > 1 &&
      !!representative &&
      !!props.guest?.address &&
      props.guest.address === representative.address &&
      props.guest.addressCountry === representative.addressCountry,
  );
  const [sameContact, setSameContact] = useState(
    () => seq > 1 && !!representative && !!props.guest?.contact && props.guest.contact === representative.contact,
  );
  const [consent, setConsent] = useState(props.guest?.consented ?? false);
  const [showMissing, setShowMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 写真から読み取った旅券番号（undefined = この画面では読み取りを試していない、null = 読み取れなかった） */
  const [mrzNumber, setMrzNumber] = useState<string | null | undefined>(
    props.guest?.passportCheck ? props.guest.passportMrzNumber : undefined,
  );
  const [ocr, setOcr] = useState<{ state: "idle" | "reading" | "done" | "failed" }>({ state: "idle" });

  /**
   * パスポートの写真から MRZ を読み取り、空欄の旅券番号・国籍・氏名に初期値として入れる（要件定義書 G-16）。
   * すでに入力されている欄は変えない。旅券番号は L と 1 のようにチェック用の数字でも見分けられない文字があるため、
   * 画面で確認を促す。入力された番号との照合の結果はサーバーで保存し、管理画面にだけ表示する（ゲストには出さない）。
   * 文字認識はサーバー経由で Google ドライブが行うので、スマホでは読み取り用のデータのダウンロードも計算もしない
   */
  const readFromPassport = async (photoId: string) => {
    setOcr({ state: "reading" });
    try {
      const { result } = await api<{ result: MrzResult | null }>(`/photos/${encodeURIComponent(photoId)}/ocr`, {
        method: "POST",
      });
      if (!result) {
        setMrzNumber(null);
        setOcr({ state: "failed" });
        return;
      }
      setMrzNumber(result.numberValid ? result.passportNumber : null);
      setG((prev) => {
        const next = { ...prev };
        if (!next.passportNumber.trim() && result.numberValid) next.passportNumber = result.passportNumber;
        const nationality = alpha3ToAlpha2(result.nationality3);
        if (!next.nationality && nationality) next.nationality = nationality;
        const name = [result.surname, result.givenNames].filter(Boolean).join(" ");
        if (!next.fullName.trim() && name && result.namesClean) next.fullName = name;
        return next;
      });
      setOcr({ state: result.numberValid ? "done" : "failed" });
    } catch {
      setMrzNumber(null);
      setOcr({ state: "failed" });
    }
  };
  const editor = useRef<HTMLElement>(null);

  const set = <K extends keyof GuestFields>(key: K, value: GuestFields[K]) => setG((prev) => ({ ...prev, [key]: value }));
  const missing = missingFields(normalizeGuest(g), checkInDate);
  const under16 = isUnder16(g.birthDate, checkInDate);
  // 同行者は本人の同意も必要（要件定義書 G-18）
  const problems: (MissingField | "consent")[] = [...missing, ...(isCompanion && !consent ? (["consent"] as const) : [])];
  /** 保存を押した後、足りない項目を赤く示す */
  const bad = (field: MissingField | "consent") => (showMissing && problems.includes(field) ? "missing" : undefined);
  const problemLabel = (p: MissingField | "consent") => (p === "consent" ? t.consentLabel : t[MISSING_KEY[p]]);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const { idPhotoId: _ignored, ...fields } = g;
      // 写真から読み取った番号（読み取りを試した場合だけ送る。読み取れなかったときは null）
      const withMrz = mrzNumber !== undefined ? { ...fields, passportMrzNumber: mrzNumber } : fields;
      const body = isCompanion ? { ...withMrz, consent } : withMrz;
      await api(isCompanion ? "" : `/guests/${seq}`, { method: "PUT", body });
      await props.onSaved();
      return true;
    } catch (e) {
      setError(e instanceof RegError && e.code === "locked" ? t.locked : t.errorGeneric);
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * 保存。足りない項目があっても途中まで保存し（要件定義書 G-12）、画面に留まって足りない項目を示す。
   * すべてそろっていれば一覧に戻る（同行者は完了の画面に切り替わる）
   */
  const finish = async () => {
    setShowMissing(true);
    setNotice(null);
    const incomplete = problems.length > 0;
    if (!(await save())) return;
    if (incomplete) {
      setNotice(t.incompleteSaved);
      requestAnimationFrame(() => editor.current?.querySelector(".missing")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    props.onBack();
  };

  const disabled = props.readOnly;

  return (
    <section className="card guest-editor" ref={editor}>
      <h2>
        {fill(t.guestN, { n: seq })}
        {seq === 1 && `（${t.representative}）`}
      </h2>
      {isCompanion && <p className="note">{t.companionNote}</p>}
      {disabled && <p className="notice">{t.locked}</p>}

      <fieldset disabled={disabled} className="form">
        <div className={`field ${bad("isJapanese") ?? ""}`}>
          <span className="label">{t.isJapanese}</span>
          <div className="segmented">
            <button type="button" className={g.isJapanese === true ? "on" : ""} onClick={() => set("isJapanese", true)}>
              {t.yes}
            </button>
            <button type="button" className={g.isJapanese === false ? "on" : ""} onClick={() => set("isJapanese", false)}>
              {t.no}
            </button>
          </div>
        </div>

        {g.isJapanese !== null && (
          <>
            <div className={`field ${bad("idPhoto") ?? ""}`}>
              <span className="label">{g.isJapanese ? t.idPhotoJapanese : t.idPhotoForeign}</span>
              {g.isJapanese && <p className="note">{t.myNumberNote}</p>}
              {g.isJapanese && under16 && <p className="note">{t.photoOptionalUnder16}</p>}
              <PhotoField
                t={t}
                api={api}
                loadPhoto={props.loadPhoto}
                uploadPath={isCompanion ? "/photos" : `/photos?seq=${seq}`}
                photoId={g.idPhotoId}
                disabled={disabled}
                useCamera={props.kiosk}
                onUploaded={(id) => {
                  set("idPhotoId", id);
                  if (g.isJapanese === false) void readFromPassport(id);
                }}
              />
              {bad("idPhoto") && <p className="alert">{t.idPhotoRequired}</p>}
              {ocr.state === "reading" && <p className="note">{t.ocrReading}</p>}
              {ocr.state === "done" && <p className="notice">{t.ocrDone}</p>}
              {ocr.state === "failed" && <p className="note">{t.ocrFailed}</p>}
            </div>

            <label className={bad("fullName")}>
              {t.fullName}
              {!g.isJapanese && <small>{t.fullNameHintForeign}</small>}
              <input value={g.fullName} onChange={(e) => set("fullName", e.target.value)} maxLength={100} autoComplete="name" />
            </label>

            <div className={`field ${bad("birthDate") ?? ""}`}>
              <span className="label">{t.birthDate}</span>
              <BirthDateSelect
                value={g.birthDate}
                checkInDate={checkInDate}
                lang={lang}
                labels={{
                  year: t.birthYear,
                  month: t.birthMonth,
                  day: t.birthDay,
                  placeholder: t.select,
                  ok: t.pickerOk,
                  cancel: t.pickerCancel,
                }}
                onChange={(v) => set("birthDate", v)}
                disabled={disabled}
              />
            </div>

            {!g.isJapanese && (
              <>
                <label className={bad("nationality")}>
                  {t.nationality}
                  <CountrySelect lang={lang} value={g.nationality} placeholder={t.select} onChange={(v) => set("nationality", v)} disabled={disabled} />
                </label>
                <label className={bad("passportNumber")}>
                  {t.passportNumber}
                  <input
                    value={g.passportNumber}
                    onChange={(e) => set("passportNumber", e.target.value.toUpperCase())}
                    maxLength={12}
                    autoCapitalize="characters"
                    autoComplete="off"
                    inputMode="text"
                  />
                  {g.passportNumber && missing.includes("passportNumber") && <small className="alert">{t.passportFormat}</small>}
                </label>
              </>
            )}

            {seq > 1 && representative && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={sameAddress}
                  onChange={(e) => {
                    setSameAddress(e.target.checked);
                    if (e.target.checked) setG((p) => ({ ...p, address: representative.address, addressCountry: representative.addressCountry }));
                    else setG((p) => ({ ...p, address: "" }));
                  }}
                />
                {t.address}: {t.sameAsRepresentative}
              </label>
            )}
            {!sameAddress && (
              <>
                <label className={bad("addressCountry")}>
                  {t.addressCountry}
                  <CountrySelect
                    lang={lang}
                    value={g.addressCountry}
                    placeholder={t.select}
                    onChange={(v) => set("addressCountry", v)}
                    disabled={disabled}
                    pinned={["JP"]}
                  />
                </label>
                <label className={bad("address")}>
                  {t.address}
                  <textarea value={g.address} onChange={(e) => set("address", e.target.value)} maxLength={300} rows={2} autoComplete="street-address" />
                </label>
              </>
            )}

            <label className={bad("occupation")}>
              {t.occupation}
              <input value={g.occupation} onChange={(e) => set("occupation", e.target.value)} maxLength={100} />
            </label>

            {seq > 1 && representative && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={sameContact}
                  onChange={(e) => {
                    setSameContact(e.target.checked);
                    set("contact", e.target.checked ? representative.contact : "");
                  }}
                />
                {t.contact}: {t.sameAsRepresentative}
              </label>
            )}
            {!sameContact && (
              <label className={bad("contact")}>
                {t.contact}
                <input value={g.contact} onChange={(e) => set("contact", e.target.value)} maxLength={100} autoComplete="tel" />
              </label>
            )}


            {isCompanion && (
              <label className={`check ${bad("consent") ?? ""}`}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  {t.consentSelf}（
                  <PrivacyLink lang={lang} label={t.privacyLink} closeLabel={t.close} />）
                </span>
              </label>
            )}
          </>
        )}
      </fieldset>

      {showMissing && problems.length > 0 && (
        <div className="alert">
          {notice && <p>{notice}</p>}
          <p>{fill(t.missing, { items: problems.map(problemLabel).join("、") })}</p>
        </div>
      )}
      {error && <p className="alert">{error}</p>}

      {!disabled && (
        <div className="actions">
          <button className="button primary" onClick={finish} disabled={saving}>
            {isCompanion ? t.done : t.save}
          </button>
          {!isCompanion && (
            <button
              className="button"
              onClick={async () => {
                if (await save()) props.onBack();
              }}
              disabled={saving}
            >
              {t.saveDraftBack}
            </button>
          )}
        </div>
      )}
      {disabled && !isCompanion && (
        <div className="actions">
          <button className="button" onClick={props.onBack}>
            {t.back}
          </button>
        </div>
      )}
    </section>
  );
}

// ---- 代表者: 一覧・送信 ----

function GuestList(props: {
  t: GuestText;
  view: RegistrationView;
  api: ReturnType<typeof useApi>;
  reload: () => Promise<void>;
  lang: Lang;
  onEdit: (seq: number) => void;
  onSubmitted: () => Promise<void>;
  /** 同行者用のリンクを共有するボタンを出す（玄関のタブレットでは出さない） */
  allowShare: boolean;
}) {
  const { t, view, api } = props;
  const [count, setCount] = useState(view.guestTotal || 1);
  const [message, setMessage] = useState<string | null>(null);
  const approved = view.regStatus === "approved";
  const byseq = new Map(view.guests.map((g) => [g.seq, g]));

  const saveCount = async (n: number) => {
    setCount(n);
    await api("/guest-count", { method: "PUT", body: { count: n } });
    await props.reload();
  };

  /** 同行者の皆さんに送る共通のリンク（LINE のグループなどに 1 つ送れば、開いた人ごとに枠を割り当てる） */
  const share = async () => {
    setMessage(null);
    let url: string;
    try {
      ({ url } = await api<{ url: string }>("/group-link", { method: "POST" }));
    } catch {
      setMessage(t.errorGeneric);
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: t.shareTitle, text: t.shareText, url }).catch(() => undefined);
    } else {
      // コピーできない環境では、リンクをそのまま表示して手でコピーしてもらう
      const copied = await navigator.clipboard?.writeText(url).then(() => true, () => false);
      setMessage(copied ? t.linkCopied : url);
    }
  };

  const addCompanion = async () => {
    const { seq } = await api<{ seq: number }>("/additions", { method: "POST" });
    await props.reload();
    props.onEdit(seq);
  };

  const rows = Array.from({ length: view.guestTotal }, (_, i) => i + 1);
  const pending = rows.filter((s) => byseq.get(s)?.status !== "approved");
  const allEntered =
    view.guestTotal > 0 && pending.length > 0 && pending.every((s) => ["ready", "submitted"].includes(byseq.get(s)?.status ?? ""));

  return (
    <section className="card">
      {!approved && (
        <label className="count">
          {t.guestCount}
          <select value={count} onChange={(e) => saveCount(Number(e.target.value))}>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
                {t.persons}
              </option>
            ))}
          </select>
        </label>
      )}
      {view.guestTotal === 0 && !approved && (
        <div className="actions">
          <button className="button primary" onClick={() => saveCount(count)}>
            OK
          </button>
        </div>
      )}

      <ul className="guest-list">
        {rows.map((seq) => {
          const g = byseq.get(seq);
          const isApproved = g?.status === "approved";
          return (
            <li key={seq}>
              <div>
                <strong>
                  {fill(t.guestN, { n: seq })}
                  {seq === 1 && `（${t.representative}）`}
                </strong>
                <div className="guest-name">{g?.fullName || "—"}</div>
                <small className={`state s-${g?.status ?? "none"}`}>
                  {guestLabel(g, t)}
                  {g?.enteredBy === "self" && `・${t.enteredBySelf}`}
                </small>
              </div>
              <div className="guest-actions">
                <button className="button" onClick={() => props.onEdit(seq)}>
                  {isApproved ? t.view : g && g.status !== "draft" ? t.edit : t.enter}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {props.allowShare && view.guestTotal > 1 && view.regStatus !== "submitted" && pending.some((s) => s > 1) && (
        <div className="share-block">
          <button className="button" onClick={share}>
            {t.shareLink}
          </button>
          <p className="note">{t.shareNote}</p>
        </div>
      )}
      {message && <p className="notice">{message}</p>}

      {approved && (
        <div className="actions">
          <button className="button" onClick={addCompanion}>
            ＋ {t.addCompanion}
          </button>
          <p className="note">{t.addCompanionNote}</p>
        </div>
      )}

      {view.guestTotal > 0 && view.regStatus !== "submitted" && (pending.length > 0 || !approved) && (
        <SubmitBlock t={t} lang={props.lang} view={view} api={api} ready={allEntered} onDone={props.onSubmitted} />
      )}
    </section>
  );
}

/** 送信（同意のチェックと送信ボタンを一覧の画面にまとめる。確認画面は挟まない） */
function SubmitBlock(props: {
  t: GuestText;
  lang: Lang;
  view: RegistrationView;
  api: ReturnType<typeof useApi>;
  ready: boolean;
  onDone: () => Promise<void>;
}) {
  const { t, view } = props;
  const [consent, setConsent] = useState(false);
  const [consentCompanions, setConsentCompanions] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const pending = view.guests.filter((g) => g.status !== "approved");
  const needsCompanionConsent = pending.some((g) => g.seq > 1 && g.enteredBy === "representative");
  const rules = view.houseRules[props.lang] || view.houseRules.en || view.houseRules.ja;
  const approved = view.regStatus === "approved";

  if (!props.ready) return <p className="note submit-note">{t.needAllEntered}</p>;

  const submit = async () => {
    setState("sending");
    try {
      await props.api("/submit", { method: "POST", body: { consent: true, consentForCompanions: consentCompanions, lang: props.lang } });
      await props.onDone();
    } catch {
      setState("error");
    }
  };

  return (
    <div className="submit-block">
      {rules && (
        <details className="rules">
          <summary>{t.houseRules}</summary>
          <p className="pre">{rules}</p>
        </details>
      )}
      <p>
        <PrivacyLink lang={props.lang} label={t.privacyLink} closeLabel={t.close} />
      </p>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {t.consentPrivacy}
      </label>
      {needsCompanionConsent && (
        <label className="check">
          <input type="checkbox" checked={consentCompanions} onChange={(e) => setConsentCompanions(e.target.checked)} />
          {t.consentCompanions}
        </label>
      )}
      {state === "error" && <p className="alert">{t.errorGeneric}</p>}
      <button
        className="button primary submit-button"
        onClick={submit}
        disabled={!consent || (needsCompanionConsent && !consentCompanions) || state === "sending"}
      >
        {state === "sending" ? t.submitting : approved ? t.submitAdditions : t.submit}
      </button>
    </div>
  );
}

// ---- 全体 ----

type Screen = { kind: "list" } | { kind: "edit"; seq: number };

/**
 * kiosk: 玄関のタブレットの中で開くとき（要件定義書 T-11）。言語はタブレットで選んだもの、同行者用のリンクの共有はなし、
 * 送信したらタブレットのチェックインに進む
 */
export function RegistrationApp({
  role,
  token,
  kiosk,
}: {
  role: "r" | "g";
  token: string;
  kiosk?: { lang: Lang; onSubmitted: () => void };
}) {
  const api = useApi(role === "r" ? "/api/r" : "/api/g", token);
  const loadPhoto = useLoadPhoto(role === "r" ? "/api/r" : "/api/g", token);
  const [lang, setLangState] = useState<Lang>(() => kiosk?.lang ?? initialLang());
  const [view, setView] = useState<RegistrationView | null>(null);
  const [failure, setFailure] = useState<"invalid" | "error" | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  /** 同行者が、完了した後に「修正する」を押したとき */
  const [companionEditing, setCompanionEditing] = useState(false);
  /** 送信が終わった（この URL はもう使えないため、読み直さずに完了の画面を出す） */
  const [submitted, setSubmitted] = useState(false);
  const t = GUEST_TEXT[lang];

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("th_lang", l);
    } catch {
      // 保存できなくても表示は切り替わる
    }
  };

  const reload = useCallback(async () => {
    try {
      setView(await api<RegistrationView>(""));
    } catch (e) {
      setFailure(e instanceof RegError && e.status === 404 ? "invalid" : "error");
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const representative = useMemo(() => view?.guests.find((g) => g.seq === 1), [view]);
  useDocumentTitle(view?.property.name);

  const header = (
    <header className="reg-header">
      <strong>{view?.property.name}</strong>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_NAME[l]}
          </option>
        ))}
      </select>
    </header>
  );

  if (failure) {
    return (
      <div className="reg">
        {header}
        <main className="reg-main">
          <p className="alert">{failure === "invalid" ? t.invalidUrl : t.errorGeneric}</p>
        </main>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="reg">
        {header}
        <main className="reg-main">
          <p className="note">{t.loading}</p>
        </main>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="reg">
        {header}
        <main className="reg-main">
          <section className="card done-card">
            <div className="done-icon">✓</div>
            <p className="done-title">{t.submittedTitle}</p>
            <p>{t.submittedClosed}</p>
          </section>
        </main>
      </div>
    );
  }

  const nights = diffDays(view.checkInDate, view.checkOutDate);
  const isCompanion = view.role === "companion";
  const own = isCompanion ? view.guests[0] : undefined;
  const companionLocked =
    isCompanion && (view.regStatus === "submitted" || own?.status === "submitted" || own?.status === "approved");

  return (
    <div className="reg">
      {header}
      <main className="reg-main">
        {view.isTest && <p className="test-banner">{t.testBanner}</p>}
        <section className="card stay">
          <div>
            <small>{t.checkIn}</small>
            <strong>{formatDate(view.checkInDate, lang)}</strong>
            <small>{view.property.checkinTime}〜</small>
          </div>
          <div className="arrow">→ {fill(t.nights, { n: nights })} →</div>
          <div>
            <small>{t.checkOut}</small>
            <strong>{formatDate(view.checkOutDate, lang)}</strong>
            <small>〜{view.property.checkoutTime}</small>
          </div>
        </section>

        {isCompanion ? (
          <>
            <p>{fill(t.companionIntro, { name: view.property.name })}</p>
            {own && own.status !== "draft" && !companionEditing ? (
              // 入力が完了したらフォームを閉じ、完了したことが一目で分かる画面にする
              <section className="card done-card">
                <div className="done-icon">✓</div>
                <p className="done-title">{t.companionDone}</p>
                <p className="guest-name">{own.fullName}</p>
                {!companionLocked && (
                  <button className="button" onClick={() => setCompanionEditing(true)}>
                    {t.editAgain}
                  </button>
                )}
              </section>
            ) : (
              <GuestEditor
                key={`g-${own?.seq}`}
                t={t}
                lang={lang}
                api={api}
                loadPhoto={loadPhoto}
                role="companion"
                seq={view.companionSeq ?? 2}
                guest={own}
                representative={undefined}
                checkInDate={view.checkInDate}
                readOnly={companionLocked}
                kiosk={false}
                onSaved={reload}
                onBack={() => {
                  setCompanionEditing(false);
                  window.scrollTo(0, 0);
                }}
              />
            )}
          </>
        ) : (
          <>
            {screen.kind === "list" && (
              <>
                {!kiosk && <p className="note">{t.repOnly}</p>}
                {/* 玄関のタブレットで登録している人には、事前登録やタブレットの案内は出さない */}
                {!kiosk && (
                  <div className="notices">
                    <p>{t.noticeTablet}</p>
                    <p>
                      <strong>{t.noticeUnregistered}</strong>
                    </p>
                  </div>
                )}
                {view.regStatus === "submitted" && <p className="notice">{t.statusSubmitted}</p>}
                {view.regStatus === "approved" && <p className="notice">{t.statusApproved}</p>}
                {view.regStatus === "rejected" && (
                  <div className="alert">
                    <p>{t.statusRejected}</p>
                    {view.rejectReason && <p className="pre">{view.rejectReason}</p>}
                  </div>
                )}
                <GuestList
                  t={t}
                  view={view}
                  api={api}
                  reload={reload}
                  lang={lang}
                  onEdit={(seq) => setScreen({ kind: "edit", seq })}
                  allowShare={!kiosk}
                  onSubmitted={async () => {
                    // 送信すると URL は使えなくなるので、読み直さずに完了の画面にする（タブレットではチェックインに進む）
                    if (kiosk) {
                      kiosk.onSubmitted();
                      return;
                    }
                    setSubmitted(true);
                    window.scrollTo(0, 0);
                  }}
                />
              </>
            )}
            {screen.kind === "edit" && (
              <GuestEditor
                key={`r-${screen.seq}`}
                t={t}
                lang={lang}
                api={api}
                loadPhoto={loadPhoto}
                role="representative"
                seq={screen.seq}
                guest={view.guests.find((g) => g.seq === screen.seq)}
                representative={screen.seq > 1 ? representative : undefined}
                checkInDate={view.checkInDate}
                readOnly={view.guests.find((g) => g.seq === screen.seq)?.status === "approved"}
                kiosk={!!kiosk}
                onSaved={reload}
                onBack={() => {
                  setScreen({ kind: "list" });
                  window.scrollTo(0, 0);
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
