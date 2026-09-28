import { useEffect, useState } from "react";
import { addDays, formatDateJa, jstNow, monthRange } from "../../shared/dates";
import { CHANNEL_LABEL, type Channel } from "../../shared/progress";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

interface LedgerPhoto {
  photoId: string;
  kind: "id" | "kiosk";
  fileName: string;
  driveUrl: string;
  takenAt: string;
  missing: boolean;
  reservationId: string;
  checkInDate: string;
  checkOutDate: string;
  channel: Channel;
  reservationCode: string | null;
  isTest: boolean;
  seq: number | null;
  fullName: string | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 名簿の CSV 出力（要件定義書 H-30） */
function RegistryExport() {
  const thisMonth = monthRange(jstNow().date.slice(0, 7));
  const [from, setFrom] = useState(thisMonth.start);
  const [to, setTo] = useState(thisMonth.end);
  const [stayedOnly, setStayedOnly] = useState(true);
  const href = `/api/admin/registry.csv?from=${from}&to=${to}&stayed=${stayedOnly ? 1 : 0}`;

  return (
    <section className="card">
      <h2>名簿の出力（CSV）</h2>
      <p className="note">宿泊日が期間に重なる予約の名簿を出力します。テスト予約は含めません。Excel でそのまま開けます。</p>
      <div className="form">
        <div className="row">
          <label>
            開始日
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            終了日
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={stayedOnly} onChange={(e) => setStayedOnly(e.target.checked)} />
          チェックインした人（宿泊した人）だけを出力する
        </label>
        <div className="actions">
          <a className="button primary" href={href} download>
            CSV をダウンロード
          </a>
        </div>
      </div>
    </section>
  );
}

/** 写真台帳（要件定義書 H-33、設計書 4.13） */
export function LedgerPage() {
  const thisMonth = monthRange(jstNow().date.slice(0, 7));
  const [from, setFrom] = useState(thisMonth.start);
  const [to, setTo] = useState(thisMonth.end);
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<LedgerPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = () => {
    setError(null);
    const params = new URLSearchParams({ from, to, name });
    api<{ photos: LedgerPhoto[] }>(`/api/admin/photos?${params}`)
      .then((r) => setPhotos(r.photos))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    search();
  }, []);

  // 予約ごとにまとめて表示する
  const groups: { reservationId: string; head: LedgerPhoto; items: LedgerPhoto[] }[] = [];
  for (const p of photos ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.reservationId === p.reservationId) last.items.push(p);
    else groups.push({ reservationId: p.reservationId, head: p, items: [p] });
  }
  const missingCount = (photos ?? []).filter((p) => p.missing).length;

  return (
    <div className="stack">
      <RegistryExport />

      <section className="card">
        <h2>写真台帳</h2>
        <p className="note">
          保存している写真を、宿泊者・宿泊日と紐付けて表示します。写真は tamahouse0930@gmail.com の Google ドライブ（TAMAHOUSE宿泊者写真）にあります。
        </p>
        <form
          className="form ledger-search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <label>
            宿泊日（開始）
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            宿泊日（終了）
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            氏名
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="一部でも可" maxLength={50} />
          </label>
          <button className="button primary" type="submit">
            検索
          </button>
        </form>
        <div className="actions">
          <button
            className="link"
            onClick={() => {
              setFrom(addDays(jstNow().date, -365 * 3));
              setTo(jstNow().date);
            }}
          >
            過去 3 年分を指定
          </button>
        </div>
      </section>

      {error && <p className="alert">{error}</p>}
      {missingCount > 0 && <p className="alert">Google ドライブで見つからない写真が {missingCount} 件あります（赤く表示しています）。</p>}
      {photos && photos.length === 0 && <p className="note">該当する写真はありません。</p>}

      {groups.map((grp) => (
        <section key={grp.reservationId} className="card ledger-group">
          <div className="ledger-head">
            <button className="link" onClick={() => navigate(`/admin/reservations/${grp.reservationId}`)}>
              {formatDateJa(grp.head.checkInDate)} 〜 {formatDateJa(grp.head.checkOutDate)}
            </button>
            <span className="note">
              {CHANNEL_LABEL[grp.head.channel]}
              {grp.head.reservationCode && ` ${grp.head.reservationCode}`}
            </span>
            {grp.head.isTest && <span className="chip warn">テスト</span>}
          </div>
          <div className="ledger-grid">
            {grp.items.map((p) => (
              <figure key={p.photoId} className={p.missing ? "missing-photo" : undefined}>
                <a href={`/api/admin/photos/${p.photoId}`} target="_blank" rel="noreferrer">
                  {p.missing ? <div className="no-photo">ドライブに見つかりません</div> : <img src={`/api/admin/photos/${p.photoId}`} alt="" loading="lazy" />}
                </a>
                <figcaption>
                  <strong>
                    {p.seq ? `${p.seq}. ` : ""}
                    {p.fullName ?? "（削除された宿泊者）"}
                  </strong>
                  <span>
                    {p.kind === "id" ? "身分証" : "当日"}・{formatTime(p.takenAt)}
                  </span>
                  <span className="file-name">{p.fileName}</span>
                  <a href={p.driveUrl} target="_blank" rel="noreferrer">
                    ドライブで開く
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
