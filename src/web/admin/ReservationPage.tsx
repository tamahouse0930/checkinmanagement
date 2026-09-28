import { useEffect, useState } from "react";
import type { ReservationDetail } from "../../shared/api-types";
import { diffDays, formatDateJa } from "../../shared/dates";
import type { GuestView } from "../../shared/guest";
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

function GuestCard({ g, phoneLast4 }: { g: GuestView; phoneLast4: string | null }) {
  const contactMatches = phoneLast4 && g.contact.replace(/\D/g, "").endsWith(phoneLast4);
  return (
    <div className="guest-card">
      <div className="guest-card-head">
        <strong>
          {g.seq}. {g.fullName || "（未入力）"}
        </strong>
        <span className={`chip g-${g.status}`}>{GUEST_STATUS[g.status]}</span>
      </div>
      <div className="guest-card-body">
        <dl className="status">
          <dt>国籍</dt>
          <dd>{g.isJapanese === null ? "—" : g.isJapanese ? "日本" : countryName(g.nationality) || "—"}</dd>
          {!g.isJapanese && g.isJapanese !== null && (
            <>
              <dt>パスポート番号</dt>
              <dd>{g.passportNumber || "—"}</dd>
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
          <dt>16 歳未満</dt>
          <dd>{g.isUnder16 ? "はい" : "いいえ"}</dd>
          <dt>入力</dt>
          <dd>{g.enteredBy === "self" ? `本人が入力${g.consented ? "（本人の同意あり）" : ""}` : "代表者が入力"}</dd>
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
    </div>
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

  const regenerate = () => {
    if (!confirm("URL を作り直しますか？ 今の URL は使えなくなります。")) return;
    act(() => api(`/api/admin/reservations/${id}/token`, { method: "POST" }), "URL を作り直しました");
  };

  const toggleBlocked = () => {
    const next = r.status === "blocked" ? "confirmed" : "blocked";
    const text = next === "blocked" ? "ブロック（予約ではない）に変更しますか？" : "予約に戻しますか？";
    if (!confirm(text)) return;
    act(() => api(`/api/admin/reservations/${id}`, { method: "PATCH", body: { status: next } }), "変更しました");
  };

  const remove = async () => {
    if (!confirm("この宿泊を削除しますか？")) return;
    try {
      await api(`/api/admin/reservations/${id}`, { method: "DELETE" });
      backToMonth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const approve = () => {
    const pendingNames = r.guests.filter((g) => g.status === "submitted").map((g) => g.fullName).join("、");
    if (!confirm(`次の方の登録を承認しますか？\n${pendingNames}`)) return;
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
              {r.regStatus === "none" && (
                <button className="button danger" onClick={remove}>
                  削除
                </button>
              )}
            </>
          ) : (
            <button className="button" onClick={toggleBlocked}>
              {r.status === "blocked" ? "予約に戻す" : "ブロックに変更"}
            </button>
          )}
        </div>
        {r.source === "ical" && r.channel === "booking" && r.status !== "blocked" && (
          <p className="note">
            Booking.com の iCal は、予約と販売停止日の区別がつきません。予約でない場合は「ブロックに変更」を押してください。
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
          {r.consentForCompanions && <p className="note">代表者が「同行者全員から同意を得ています」にチェックしています。</p>}
          <div className="guest-cards">
            {r.guests.map((g) => (
              <GuestCard key={g.seq} g={g} phoneLast4={r.phoneLast4} />
            ))}
          </div>
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
          <p className="note">清掃のときに現地で変えた番号を入力してください。番号を変えると「送信済み」の印は外れます。</p>
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
            <p className="note">承認して暗証番号を保存すると、案内文をコピーできます。</p>
          )}
        </section>
      )}
    </div>
  );
}
