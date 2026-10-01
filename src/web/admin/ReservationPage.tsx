import { useEffect, useRef, useState } from "react";
import { resizeImage } from "../registration/photo";
import { GuestForm } from "./GuestForm";
import type { ReservationDetail } from "../../shared/api-types";
import { diffDays, formatDateJa } from "../../shared/dates";
import { birthDateLabel, type GuestView } from "../../shared/guest";
import { LANG_NAME, LANGS, type Lang } from "../../shared/langs";
import { CHANNEL_LABEL, PROGRESS_LABEL } from "../../shared/progress";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

const GUEST_STATUS: Record<GuestView["status"], string> = {
  draft: "入力中",
  ready: "入力済み（未送信）",
  submitted: "承認待ち",
  approved: "承認済み",
};

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["ja"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

/** 案内文のコピー。コピーした時点で送信済みの印を付ける（要件定義書 H-10、H-14） */
function MessageBlock(props: {
  title: string;
  texts: Record<Lang, string>;
  defaultLang: Lang;
  sentAt: string | null;
  markPath: string | null;
  onChanged: () => Promise<void>;
}) {
  const [lang, setLang] = useState<Lang>(props.defaultLang);
  const [copied, setCopied] = useState(false);
  const text = props.texts[lang];

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (props.markPath) {
      await api(props.markPath, { method: "POST" });
      await props.onChanged();
    }
  };

  const unmark = async () => {
    if (!props.markPath || !confirm("送信済みの印を外しますか？")) return;
    await api(props.markPath, { method: "DELETE" });
    await props.onChanged();
  };

  return (
    <div className="message-block">
      <div className="message-head">
        <strong>{props.title}</strong>
        {props.markPath &&
          (props.sentAt ? (
            <span className="chip sent">
              ✓ 送信済み（{formatTime(props.sentAt)}）
              <button className="link" onClick={unmark}>
                印を外す
              </button>
            </span>
          ) : (
            <span className="chip warn">未送信</span>
          ))}
      </div>
      <div className="message-tools">
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_NAME[l]}
            </option>
          ))}
        </select>
        <button className="button primary" onClick={copy}>
          案内文をコピー
        </button>
        {copied && <small>コピーしました。予約サイトのメッセージに貼り付けてください</small>}
      </div>
      <pre className="message-text">{text}</pre>
    </div>
  );
}

/** 写真を選んで縮小してから送る（管理者による差し替え） */
async function uploadAdminPhoto(guestId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", await resizeImage(file), "photo.jpg");
  const res = await fetch(`/api/admin/guests/${guestId}/photo`, { method: "PUT", body: form, credentials: "same-origin" });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message ?? `写真を保存できませんでした（${res.status}）`);
  }
}

function GuestCard({
  g,
  checkInDate,
  phoneLast4,
  editable,
  act,
}: {
  g: GuestView;
  checkInDate: string;
  phoneLast4: string | null;
  editable: boolean;
  act: (action: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const contactMatches = phoneLast4 && g.contact.replace(/\D/g, "").endsWith(phoneLast4);
  const [editing, setEditing] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const remove = () => {
    const reason = prompt(`${g.fullName || `${g.seq}人目`} を名簿から削除します。理由を入力してください（来なかった、など）`);
    if (!reason?.trim()) return;
    act(() => api(`/api/admin/guests/${g.id}`, { method: "DELETE", body: { reason } }), "宿泊者を削除しました");
  };

  if (editing) {
    return (
      <div className="guest-card">
        <strong>
          {g.seq}. {g.fullName || "（未入力）"} の修正
        </strong>
        <GuestForm
          initial={g}
          checkInDate={checkInDate}
          submitLabel="保存"
          withReason
          onCancel={() => setEditing(false)}
          onSubmit={async (fields, reason) => {
            await api(`/api/admin/guests/${g.id}`, { method: "PATCH", body: { ...fields, reason } });
            setEditing(false);
            await act(async () => undefined, "修正しました（変更前の内容は記録に残ります）");
          }}
        />
      </div>
    );
  }

  const passportMismatch = g.passportCheck === "mismatch";

  return (
    <div className={`guest-card${passportMismatch ? " passport-mismatch" : ""}`}>
      <div className="guest-card-head">
        <strong>
          {g.seq}. {g.fullName || "（未入力）"}
        </strong>
        <span>
          {passportMismatch && <span className="chip danger">パスポート番号 不一致</span>}
          <span className={`chip g-${g.status}`}>{GUEST_STATUS[g.status]}</span>
        </span>
      </div>
      <div className="guest-card-body">
        <dl className="status">
          <dt>国籍</dt>
          <dd>{g.isJapanese === null ? "—" : g.isJapanese ? "日本" : countryName(g.nationality) || "—"}</dd>
          {!g.isJapanese && g.isJapanese !== null && (
            <>
              <dt>パスポート番号</dt>
              <dd>
                {g.passportNumber || "—"}
                {g.passportCheck === "match" && <small className="note">（写真の番号と一致）</small>}
                {passportMismatch && (
                  <small className="warn-text">
                    {" "}
                    （写真から読み取った番号は <strong>{g.passportMrzNumber}</strong>。写真で確認してください）
                  </small>
                )}
                {g.passportCheck === "unreadable" && <small className="note">（写真から番号を読み取れませんでした。写真で確認してください）</small>}
              </dd>
            </>
          )}
          <dt>住所</dt>
          <dd>
            {g.addressCountry && `${countryName(g.addressCountry)} `}
            {g.address || "—"}
          </dd>
          <dt>職業</dt>
          <dd>{g.occupation || "—"}</dd>
          <dt>連絡先</dt>
          <dd>
            {g.contact || "—"}
            {g.seq === 1 && phoneLast4 && (
              <small className={contactMatches ? "ok" : "warn-text"}>
                {" "}
                （予約の電話番号の下 4 桁 {phoneLast4}：{contactMatches ? "一致" : "不一致"}）
              </small>
            )}
          </dd>
          <dt>生年月日</dt>
          <dd>{birthDateLabel(g.birthDate, checkInDate, g.isUnder16)}</dd>
          <dt>入力</dt>
          <dd>
            {g.enteredBy === "self" ? `本人が入力${g.consented ? "（本人の同意あり）" : ""}` : g.enteredBy === "admin" ? "管理者が追加" : "代表者が入力"}
          </dd>
        </dl>
        <div className="guest-photo">
          {g.idPhotoId ? (
            <a href={`/api/admin/photos/${g.idPhotoId}`} target="_blank" rel="noreferrer">
              <img src={`/api/admin/photos/${g.idPhotoId}`} alt={`${g.fullName} の身分証`} loading="lazy" />
            </a>
          ) : (
            <div className="no-photo">{g.isJapanese && g.isUnder16 ? "16 歳未満（身分証なし）" : "写真なし"}</div>
          )}
          <small>{g.isJapanese === false ? "パスポート" : "身分証"}</small>
        </div>
      </div>
      {editable && (
        <div className="actions guest-admin-actions">
          <button className="button" onClick={() => setEditing(true)}>
            修正
          </button>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) act(() => uploadAdminPhoto(g.id, file), "身分証の写真を差し替えました");
            }}
          />
          <button className="button" onClick={() => photoInput.current?.click()}>
            写真を差し替え
          </button>
          {g.seq > 1 && !g.checkedInAt && (
            <button className="button danger" onClick={remove}>
              削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 管理者による宿泊者の追加（予約サイトのメッセージで情報を受け取った場合など） */
function AddGuest({
  reservationId,
  checkInDate,
  act,
}: {
  reservationId: string;
  checkInDate: string;
  act: (action: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="button" onClick={() => setOpen(true)}>
        ＋ 宿泊者を追加
      </button>
    );
  }
  return (
    <div className="guest-card">
      <strong>宿泊者の追加（承認済みとして登録します。身分証の写真は追加した後に「写真を差し替え」で登録してください）</strong>
      <GuestForm
        checkInDate={checkInDate}
        submitLabel="追加"
        onCancel={() => setOpen(false)}
        onSubmit={async (fields) => {
          await api(`/api/admin/reservations/${reservationId}/guests`, { method: "POST", body: fields });
          setOpen(false);
          await act(async () => undefined, "宿泊者を追加しました");
        }}
      />
    </div>
  );
}

/** 写真の照合（身分証の写真と当日の写真を並べる。要件定義書 H-20） */
function VerifySection(props: { r: ReservationDetail; act: (action: () => Promise<unknown>, done: string) => Promise<void> }) {
  const { r, act } = props;
  const [showMismatch, setShowMismatch] = useState(false);
  const [note, setNote] = useState("");
  const approved = r.guests.filter((g) => g.status === "approved");
  const checkedIn = approved.filter((g) => g.checkedInAt);

  const verify = () => {
    if (!confirm("全員の写真を確認して、照合 OK にしますか？")) return;
    act(() => api(`/api/admin/reservations/${r.id}/verify-photos`, { method: "POST", body: { result: "ok" } }), "照合 OK にしました");
  };
  const mismatch = () =>
    act(async () => {
      await api(`/api/admin/reservations/${r.id}/verify-photos`, { method: "POST", body: { result: "mismatch", note } });
      setShowMismatch(false);
    }, "不一致を記録しました。駆けつけの担当者に連絡してください");
  const undoVerify = () => act(() => api(`/api/admin/reservations/${r.id}/verify-photos`, { method: "DELETE" }), "照合の記録を取り消しました");
  const checkout = () => {
    if (!confirm("管理者の操作でチェックアウト済みにしますか？")) return;
    act(() => api(`/api/admin/reservations/${r.id}/checkout`, { method: "POST" }), "チェックアウト済みにしました");
  };
  const undoCheckout = () => {
    if (!confirm("チェックアウトを取り消しますか？")) return;
    act(() => api(`/api/admin/reservations/${r.id}/checkout`, { method: "DELETE" }), "チェックアウトを取り消しました");
  };

  return (
    <section className="card">
      <h2>④ チェックイン・写真の照合</h2>
      <dl className="status">
        <dt>チェックイン</dt>
        <dd>
          {checkedIn.length} / {approved.length}人{r.firstCheckinAt && `（最初: ${formatTime(r.firstCheckinAt)}）`}
        </dd>
        <dt>チェックアウト</dt>
        <dd>
          {r.checkedOutAt
            ? `${formatTime(r.checkedOutAt)}（${r.checkedOutBy === "kiosk" ? "タブレット" : "管理者"}）`
            : r.stayStatus === "in_house"
              ? "滞在中"
              : "—"}
        </dd>
        <dt>照合</dt>
        <dd>
          {r.photosVerifiedAt ? (r.photoMismatch ? `不一致あり（${formatTime(r.photosVerifiedAt)}）` : `照合 OK（${formatTime(r.photosVerifiedAt)}）`) : checkedIn.length > 0 ? "照合待ち" : "—"}
        </dd>
      </dl>
      {r.photoMismatch && <p className="alert pre">不一致の内容: {r.photoMismatch}</p>}

      {approved.length > 0 && (
        <div className="verify-grid">
          {approved.map((g) => (
            <div key={g.seq} className="verify-row">
              <strong>
                {g.seq}. {g.fullName}
              </strong>
              <div className="verify-photos">
                <figure>
                  {g.idPhotoId ? (
                    <img src={`/api/admin/photos/${g.idPhotoId}`} alt="" loading="lazy" />
                  ) : (
                    <div className="no-photo">{g.isJapanese && g.isUnder16 ? "16 歳未満（身分証なし）" : "写真なし"}</div>
                  )}
                  <figcaption>{g.isJapanese === false ? "パスポート" : "身分証"}</figcaption>
                </figure>
                <figure>
                  {g.kioskPhotoId ? (
                    <img src={`/api/admin/photos/${g.kioskPhotoId}`} alt="" loading="lazy" />
                  ) : (
                    <div className="no-photo">未チェックイン</div>
                  )}
                  <figcaption>当日{g.checkedInAt && ` ${formatTime(g.checkedInAt)}`}</figcaption>
                </figure>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="actions">
        {checkedIn.length > 0 && !r.photosVerifiedAt && (
          <>
            <button className="button primary" onClick={verify}>
              全員を確認した：照合 OK
            </button>
            <button className="button danger" onClick={() => setShowMismatch(!showMismatch)}>
              不一致あり
            </button>
          </>
        )}
        {r.photosVerifiedAt && (
          <button className="button" onClick={undoVerify}>
            照合の記録を取り消す
          </button>
        )}
        {r.stayStatus !== "checked_out" && r.regStatus === "approved" && (
          <button className="button" onClick={checkout}>
            管理者の操作でチェックアウト
          </button>
        )}
        {r.stayStatus === "checked_out" && (
          <button className="button" onClick={undoCheckout}>
            チェックアウトを取り消す
          </button>
        )}
      </div>
      {showMismatch && (
        <div className="form">
          <label>
            不一致の内容（誰の写真が一致しないかなど）
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
          </label>
          <div className="actions">
            <button className="button danger" onClick={mismatch} disabled={!note.trim()}>
              記録する
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ReservationPage({ id }: { id: string }) {
  const [r, setR] = useState<ReservationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [keybox, setKeybox] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const load = () =>
    api<ReservationDetail>(`/api/admin/reservations/${id}`)
      .then((d) => {
        setR(d);
        setKeybox(d.keyboxCode ?? "");
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, [id]);

  const act = async (action: () => Promise<unknown>, done: string) => {
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(done);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error && !r) return <p className="alert">{error}</p>;
  if (!r) return <p className="note">読み込み中…</p>;

  const nights = diffDays(r.checkInDate, r.checkOutDate);
  const backToMonth = () => navigate(`/admin?month=${r.checkInDate.slice(0, 7)}`);
  const guestLang: Lang = r.lang ?? "en";
  const canJudge = r.regStatus === "submitted" || (r.regStatus === "approved" && r.guestPending > 0);
  const mismatchNames = r.guests.filter((g) => g.passportCheck === "mismatch").map((g) => `${g.seq}. ${g.fullName || "（未入力）"}`);

  const regenerate = () => {
    if (!confirm("URL を作り直しますか？ 今の URL は使えなくなります。")) return;
    act(() => api(`/api/admin/reservations/${id}/token`, { method: "POST" }), "URL を作り直しました");
  };

  // 削除できるのは、テスト予約か、誰もチェックインしていない手動登録の予約（チェックイン後は 3 年間の保存が必要）。
  // 予約サイトから取り込んだ予約は参照のみで、削除もキャンセルもできない
  const canRemove = r.isTest || (r.source === "manual" && r.stayStatus === "not_arrived" && !r.firstCheckinAt);
  const hasGuestData = r.guests.length > 0;

  const remove = async () => {
    const text = r.isTest
      ? "このテスト予約を削除しますか？ 名簿と写真（Google ドライブのフォルダ）もすべて削除します。"
      : `この宿泊を削除しますか？${hasGuestData ? "\n登録された名簿と写真もすべて削除します。" : ""}`;
    if (!confirm(text)) return;
    try {
      await api(`/api/admin/reservations/${id}`, { method: "DELETE" });
      backToMonth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const approve = () => {
    const pending = r.guests.filter((g) => g.status === "submitted");
    const pendingNames = pending.map((g) => g.fullName).join("、");
    const pendingMismatch = pending.filter((g) => g.passportCheck === "mismatch").map((g) => g.fullName);
    const warning = pendingMismatch.length > 0 ? `\n\n※ パスポート番号が写真と違う人がいます: ${pendingMismatch.join("、")}` : "";
    if (!confirm(`次の方の登録を承認しますか？\n${pendingNames}${warning}`)) return;
    act(() => api(`/api/admin/reservations/${id}/approve`, { method: "POST" }), "承認しました。暗証番号を設定して、案内文を送ってください");
  };

  const reject = () =>
    act(async () => {
      await api(`/api/admin/reservations/${id}/reject`, { method: "POST", body: { reason: rejectReason } });
      setShowReject(false);
      setRejectReason("");
    }, "差し戻しました。差し戻しの案内文を予約サイトのメッセージで送ってください");

  const saveKeybox = () =>
    act(() => api(`/api/admin/reservations/${id}/keybox`, { method: "PUT", body: { code: keybox } }), "暗証番号を保存しました");

  return (
    <div className="stack">
      <button className="link" onClick={backToMonth}>
        ← カレンダーに戻る
      </button>

      <section className="card">
        <h2>
          {formatDateJa(r.checkInDate)} 〜 {formatDateJa(r.checkOutDate)}（{nights}泊）
          {r.isTest && <span className="chip warn">テスト</span>}
        </h2>
        <dl className="status">
          <dt>状態</dt>
          <dd>
            <span className={`badge p-${r.progress}`}>{PROGRESS_LABEL[r.progress]}</span>
          </dd>
          <dt>予約経路</dt>
          <dd>
            {CHANNEL_LABEL[r.channel]}（{r.source === "ical" ? "iCal から取り込み" : "手動登録"}）
          </dd>
          {r.reservationCode && (
            <>
              <dt>予約コード</dt>
              <dd>{r.reservationCode}</dd>
            </>
          )}
          {r.phoneLast4 && (
            <>
              <dt>電話番号（下 4 桁）</dt>
              <dd>{r.phoneLast4}</dd>
            </>
          )}
          {r.bookerName && (
            <>
              <dt>代表者名（手動登録）</dt>
              <dd>{r.bookerName}</dd>
            </>
          )}
          {r.note && (
            <>
              <dt>メモ</dt>
              <dd className="pre">{r.note}</dd>
            </>
          )}
          <dt>宿泊者</dt>
          <dd>{r.guestTotal > 0 ? `${r.guestTotal}人（チェックイン ${r.guestCheckedIn}人）` : "未登録"}</dd>
          {r.submittedAt && (
            <>
              <dt>送信日時</dt>
              <dd>{formatTime(r.submittedAt)}</dd>
            </>
          )}
          {r.lang && (
            <>
              <dt>代表者の言語</dt>
              <dd>{LANG_NAME[r.lang]}</dd>
            </>
          )}
        </dl>
        <div className="actions">
          {r.source === "manual" ? (
            <>
              <button className="button" onClick={() => navigate(`/admin/reservations/${id}/edit`)}>
                編集
              </button>
              {canRemove && (
                <button className="button danger" onClick={remove}>
                  削除
                </button>
              )}
            </>
          ) : null}
        </div>
        {r.source === "manual" && !canRemove && r.firstCheckinAt && (
          <p className="note">チェックインした宿泊者がいるため削除できません（名簿と写真は 3 年間の保存が必要です）。</p>
        )}
        {r.source === "ical" && (
          <p className="note read-only-note">
            予約サイトから取り込んだ予約です。このアプリからは変更できません（参照のみ）。変更・キャンセルは予約サイトで行ってください。次の取り込み（毎朝 5 時、またはカレンダーの「最新化」）で反映されます。
            {r.channel === "booking" && r.status === "confirmed" && " Booking.com の iCal は、予約と販売停止日の区別がつきません。予約でない日程も「予約」として表示されます。"}
          </p>
        )}
      </section>

      {message && <p className="notice">{message}</p>}
      {error && <p className="alert">{error}</p>}

      {r.status === "confirmed" && r.guestUrl && (
        <section className="card">
          <h2>① 宿泊者入力画面の URL を送る</h2>
          <MessageBlock
            title="URL の案内文"
            texts={r.messages.invite}
            defaultLang="en"
            sentAt={r.inviteSentAt}
            markPath={`/api/admin/reservations/${id}/invite-sent`}
            onChanged={load}
          />
          <div className="actions">
            <a className="button" href={r.guestUrl} target="_blank" rel="noreferrer">
              宿泊者入力画面を開く
            </a>
            <button className="button" onClick={regenerate}>
              URL を作り直す
            </button>
          </div>
        </section>
      )}

      {r.guests.length > 0 && (
        <section className="card">
          <h2>② 登録内容の確認</h2>
          {mismatchNames.length > 0 && (
            <p className="alert">
              パスポート番号が、写真から読み取った番号と違う人がいます: {mismatchNames.join("、")}
              。承認の前に、パスポートの写真で番号を確認してください。
            </p>
          )}
          {r.consentForCompanions && <p className="note">代表者が「同行者全員から同意を得ています」にチェックしています。</p>}
          <div className="guest-cards">
            {r.guests.map((g) => (
              <GuestCard key={g.id} g={g} checkInDate={r.checkInDate} phoneLast4={r.phoneLast4} editable={r.status === "confirmed"} act={act} />
            ))}
          </div>
          {r.status === "confirmed" && (
            <div className="actions">
              <AddGuest reservationId={r.id} checkInDate={r.checkInDate} act={act} />
            </div>
          )}
          {canJudge ? (
            <div className="actions">
              <button className="button primary" onClick={approve}>
                {r.regStatus === "approved" ? "追加分を承認" : "承認する"}
              </button>
              <button className="button" onClick={() => setShowReject(!showReject)}>
                差し戻す
              </button>
            </div>
          ) : (
            <p className="note">
              {r.regStatus === "approved"
                ? "承認済みです。"
                : r.regStatus === "rejected"
                  ? "差し戻し中です。ゲストが修正して送信すると、承認できるようになります。"
                  : "ゲストが送信すると、承認できるようになります。"}
            </p>
          )}
          {showReject && (
            <div className="form">
              <label>
                差し戻しの理由（ゲストの画面と案内文に表示されます）
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} maxLength={500} />
              </label>
              <div className="actions">
                <button className="button danger" onClick={reject} disabled={!rejectReason.trim()}>
                  差し戻す
                </button>
              </div>
            </div>
          )}
          {r.messages.reject && (
            <MessageBlock title="差し戻しの案内文" texts={r.messages.reject} defaultLang={guestLang} sentAt={null} markPath={null} onChanged={load} />
          )}
        </section>
      )}

      {r.status === "confirmed" && (
        <section className="card">
          <h2>③ 暗証番号を送る</h2>
          <div className="form inline keybox">
            <input
              value={keybox}
              onChange={(e) => setKeybox(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={8}
              placeholder="キーボックスの暗証番号（数字 3〜8 桁）"
            />
            <button className="button" onClick={saveKeybox} disabled={!/^\d{3,8}$/.test(keybox) || keybox === (r.keyboxCode ?? "")}>
              保存
            </button>
          </div>
          <p className="note">
            {r.phoneLast4
              ? `初期値は予約の電話番号の下 4 桁（${r.phoneLast4}）です。`
              : "電話番号の下 4 桁がない予約（Booking.com・手動登録など）のため、初期値はありません。"}
            清掃のときに現地で別の番号にした場合は、その番号を入力してください。番号を変えると「送信済み」の印は外れます。
          </p>
          {r.messages.code ? (
            <MessageBlock
              title="暗証番号の案内文"
              texts={r.messages.code}
              defaultLang={guestLang}
              sentAt={r.codeSentAt}
              markPath={`/api/admin/reservations/${id}/code-sent`}
              onChanged={load}
            />
          ) : (
            <p className="note">{r.keyboxCode ? "承認すると、案内文をコピーできます。" : "承認して暗証番号を保存すると、案内文をコピーできます。"}</p>
          )}
        </section>
      )}

      {r.regStatus === "approved" || r.guestCheckedIn > 0 || r.stayStatus !== "not_arrived" ? <VerifySection r={r} act={act} /> : null}
    </div>
  );
}
