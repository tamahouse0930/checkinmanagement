import { useEffect, useState } from "react";
import type { ReservationDetail } from "../../shared/api-types";
import { diffDays, formatDateJa } from "../../shared/dates";
import { CHANNEL_LABEL, PROGRESS_LABEL } from "../../shared/progress";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

/** 予約詳細（段階 2: 予約の情報、宿泊者入力画面の URL、ブロックへの変更、手動登録の編集・削除） */
export function ReservationPage({ id }: { id: string }) {
  const [r, setR] = useState<ReservationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    api<ReservationDetail>(`/api/admin/reservations/${id}`)
      .then(setR)
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

  const copyUrl = async () => {
    if (!r.guestUrl) return;
    await navigator.clipboard.writeText(r.guestUrl);
    setMessage("URL をコピーしました");
  };

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
              <dt>電話番号の下 4 桁</dt>
              <dd>{r.phoneLast4}</dd>
            </>
          )}
          {r.bookerName && (
            <>
              <dt>代表者名</dt>
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
        </dl>
        <div className="actions">
          {r.source === "manual" ? (
            <>
              <button className="button" onClick={() => navigate(`/admin/reservations/${id}/edit`)}>
                編集
              </button>
              <button className="button danger" onClick={remove}>
                削除
              </button>
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

      {r.status !== "blocked" && r.guestUrl && (
        <section className="card">
          <h2>宿泊者入力画面の URL</h2>
          <p className="url">{r.guestUrl}</p>
          <div className="actions">
            <button className="button primary" onClick={copyUrl}>
              URL をコピー
            </button>
            <a className="button" href={r.guestUrl} target="_blank" rel="noreferrer">
              宿泊者入力画面を開く
            </a>
            <button className="button" onClick={regenerate}>
              URL を作り直す
            </button>
          </div>
          <p className="note">案内文のコピーと「送信済み」の印は、次の段階で追加します。</p>
        </section>
      )}

      {message && <p className="notice">{message}</p>}
      {error && <p className="alert">{error}</p>}
    </div>
  );
}
