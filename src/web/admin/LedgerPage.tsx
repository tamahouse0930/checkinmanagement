import { useEffect, useState } from "react";
import { addDays, diffDays, formatDateJa, jstNow, monthRange } from "../../shared/dates";
import { CHANNEL_LABEL, type Channel } from "../../shared/progress";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

/** 名簿管理（要件定義書 H-30、H-33）。検索結果は宿泊の一覧、日付を押すとその宿泊の名簿と写真を表示する */

interface StaySummary {
  reservationId: string;
  checkInDate: string;
  checkOutDate: string;
  channel: Channel;
  reservationCode: string | null;
  status: string;
  isTest: boolean;
  representative: string | null;
  guestTotal: number;
  guestCheckedIn: number;
  photoCount: number;
  missingCount: number;
}

interface PhotoInfo {
  photoId: string;
  fileName: string;
  driveUrl: string;
  takenAt: string;
  missing: boolean;
}

interface StayGuest {
  id: string;
  seq: number;
  status: string;
  fullName: string | null;
  isJapanese: boolean | null;
  nationality: string | null;
  passportNumber: string | null;
  addressCountry: string | null;
  address: string | null;
  occupation: string | null;
  contact: string | null;
  isUnder16: boolean;
  checkedInAt: string | null;
  idPhoto: PhotoInfo | null;
  kioskPhoto: PhotoInfo | null;
}

interface StayDetail {
  stay: {
    reservationId: string;
    checkInDate: string;
    checkOutDate: string;
    channel: Channel;
    reservationCode: string | null;
    status: string;
    isTest: boolean;
    firstCheckinAt: string | null;
    checkedOutAt: string | null;
    photosVerifiedAt: string | null;
    photoMismatch: string | null;
  };
  guests: StayGuest[];
}

function formatTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

function countryName(code: string | null): string {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames(["ja"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 検索条件は URL に残し、名簿から戻ったときに同じ結果を表示する */
function readQuery() {
  const p = new URLSearchParams(location.search);
  const month = monthRange(jstNow().date.slice(0, 7));
  return { from: p.get("from") ?? month.start, to: p.get("to") ?? month.end, name: p.get("name") ?? "" };
}

/** 名簿の出力（CSV。要件定義書 H-30） */
function RegistryExport({ from: initialFrom, to: initialTo }: { from: string; to: string }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [stayedOnly, setStayedOnly] = useState(true);
  const href = `/api/admin/registry.csv?from=${from}&to=${to}&stayed=${stayedOnly ? 1 : 0}`;

  return (
    <details className="card export-card">
      <summary>
        <strong>名簿の出力（CSV）</strong>
      </summary>
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
    </details>
  );
}

/** 検索結果: 期間に該当する宿泊の一覧 */
export function LedgerPage() {
  const initial = readQuery();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [name, setName] = useState(initial.name);
  const [stays, setStays] = useState<StaySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = (f = from, t = to, n = name) => {
    setError(null);
    const params = new URLSearchParams({ from: f, to: t, name: n });
    history.replaceState(null, "", `/admin/photos?${params}`);
    api<{ stays: StaySummary[] }>(`/api/admin/stays?${params}`)
      .then((r) => setStays(r.stays))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    search();
  }, []);

  const openStay = (id: string) => navigate(`/admin/photos/${id}?${new URLSearchParams({ from, to, name })}`);

  return (
    <div className="stack">
      <section className="card">
        <h2>名簿管理</h2>
        <p className="note">期間を指定して検索すると、その期間の宿泊が一覧で表示されます。日付を押すと、その宿泊の名簿と写真を表示します。</p>
        <form
          className="form ledger-search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <label>
            宿泊日（From）
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            宿泊日（To）
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            氏名（任意）
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
              const f = addDays(jstNow().date, -365 * 3);
              const t = jstNow().date;
              setFrom(f);
              setTo(t);
              search(f, t, name);
            }}
          >
            過去 3 年分を検索
          </button>
          <span className="spacer" />
          <button
            className="button"
            onClick={() => navigate(`/admin/photos/print?${new URLSearchParams({ from, to, stayed: "1", copies: "1" })}`)}
          >
            この期間の宿泊者名簿を表示（印刷・PDF）
          </button>
        </div>
        <p className="note">特定の日の名簿を見るときは、From と To に同じ日を指定してください。</p>
      </section>

      {error && <p className="alert">{error}</p>}

      {stays && (
        <section className="card">
          <h2>検索結果（{stays.length}件）</h2>
          {stays.length === 0 ? (
            <p className="note">該当する宿泊はありません。</p>
          ) : (
            <div className="table-wrap">
              <table className="stay-table">
                <thead>
                  <tr>
                    <th>宿泊日</th>
                    <th>予約経路</th>
                    <th>代表者</th>
                    <th>人数</th>
                    <th>チェックイン</th>
                    <th>写真</th>
                  </tr>
                </thead>
                <tbody>
                  {stays.map((s) => (
                    <tr key={s.reservationId}>
                      <td>
                        <a
                          href={`/admin/photos/${s.reservationId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            openStay(s.reservationId);
                          }}
                        >
                          {formatDateJa(s.checkInDate)} 〜 {formatDateJa(s.checkOutDate)}
                        </a>
                        <small> {diffDays(s.checkInDate, s.checkOutDate)}泊</small>
                        {s.isTest && <span className="chip warn">テスト</span>}
                        {s.status === "cancelled" && <span className="chip">キャンセル</span>}
                      </td>
                      <td>
                        {CHANNEL_LABEL[s.channel]}
                        {s.reservationCode && <small> {s.reservationCode}</small>}
                      </td>
                      <td>{s.representative ?? "—"}</td>
                      <td>{s.guestTotal}人</td>
                      <td>{s.guestCheckedIn}人</td>
                      <td>
                        {s.photoCount}枚
                        {s.missingCount > 0 && <span className="warn-text">（{s.missingCount}枚見つかりません）</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <RegistryExport from={from} to={to} />
    </div>
  );
}

function PhotoBox({ label, photo, emptyText }: { label: string; photo: PhotoInfo | null; emptyText: string }) {
  return (
    <figure className={photo?.missing ? "missing-photo" : undefined}>
      <figcaption className="photo-label">{label}</figcaption>
      {photo ? (
        photo.missing ? (
          <div className="no-photo">Google ドライブに見つかりません</div>
        ) : (
          <a href={`/api/admin/photos/${photo.photoId}`} target="_blank" rel="noreferrer">
            <img src={`/api/admin/photos/${photo.photoId}`} alt={label} loading="lazy" />
          </a>
        )
      ) : (
        <div className="no-photo">{emptyText}</div>
      )}
      {photo && (
        <figcaption>
          <span>{formatTime(photo.takenAt)}</span>
          <span className="file-name">{photo.fileName}</span>
          <a className="no-print" href={photo.driveUrl} target="_blank" rel="noreferrer">
            ドライブで開く
          </a>
        </figcaption>
      )}
    </figure>
  );
}

/** 宿泊の名簿: 宿泊者ごとに、名簿の項目と、事前登録の写真・チェックイン時の写真を並べる */
export function LedgerStayPage({ id }: { id: string }) {
  const [data, setData] = useState<StayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<StayDetail>(`/api/admin/stays/${id}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const back = () => navigate(`/admin/photos${location.search}`);

  if (error) return <p className="alert">{error}</p>;
  if (!data) return <p className="note">読み込み中…</p>;
  const { stay, guests } = data;

  return (
    <div className="stack">
      <div className="no-print actions">
        <button className="link" onClick={back}>
          ← 検索結果に戻る
        </button>
        <span className="spacer" />
        <button className="button primary" onClick={() => window.print()}>
          印刷・PDFで保存
        </button>
      </div>

      <section className="card">
        <h2>
          {formatDateJa(stay.checkInDate)} 〜 {formatDateJa(stay.checkOutDate)}（{diffDays(stay.checkInDate, stay.checkOutDate)}泊）
          {stay.isTest && <span className="chip warn">テスト</span>}
        </h2>
        <dl className="status">
          <dt>予約経路</dt>
          <dd>
            {CHANNEL_LABEL[stay.channel]}
            {stay.reservationCode && ` ${stay.reservationCode}`}
          </dd>
          <dt>チェックイン</dt>
          <dd>{formatTime(stay.firstCheckinAt)}</dd>
          <dt>チェックアウト</dt>
          <dd>{formatTime(stay.checkedOutAt)}</dd>
          <dt>写真の照合</dt>
          <dd>{stay.photosVerifiedAt ? (stay.photoMismatch ? `不一致あり（${stay.photoMismatch}）` : "照合 OK") : "未照合"}</dd>
        </dl>
        <div className="actions no-print">
          <button className="button" onClick={() => navigate(`/admin/reservations/${stay.reservationId}`)}>
            予約詳細を開く（修正・削除はこちら）
          </button>
        </div>
      </section>

      <section className="card">
        <h2>名簿（{guests.length}人）</h2>
        {guests.length === 0 && <p className="note">名簿は登録されていません。</p>}
        <div className="register-list">
          {guests.map((g) => (
            <div key={g.id} className="register-row">
              <div className="register-info">
                <strong>
                  {g.seq}. {g.fullName ?? "（未入力）"}
                </strong>
                <dl className="status">
                  <dt>国籍</dt>
                  <dd>{g.isJapanese === null ? "—" : g.isJapanese ? "日本" : countryName(g.nationality)}</dd>
                  {g.isJapanese === false && (
                    <>
                      <dt>旅券番号</dt>
                      <dd>{g.passportNumber ?? "—"}</dd>
                    </>
                  )}
                  <dt>住所</dt>
                  <dd>
                    {g.addressCountry && `${countryName(g.addressCountry)} `}
                    {g.address ?? "—"}
                  </dd>
                  <dt>職業</dt>
                  <dd>{g.occupation ?? "—"}</dd>
                  <dt>連絡先</dt>
                  <dd>{g.contact ?? "—"}</dd>
                  <dt>16 歳未満</dt>
                  <dd>{g.isUnder16 ? "はい" : "いいえ"}</dd>
                  <dt>チェックイン</dt>
                  <dd>{formatTime(g.checkedInAt)}</dd>
                </dl>
              </div>
              <div className="register-photos">
                <PhotoBox
                  label={`事前登録の写真（${g.isJapanese === false ? "パスポート" : "身分証"}）`}
                  photo={g.idPhoto}
                  emptyText={g.isJapanese && g.isUnder16 ? "16 歳未満（身分証なし）" : "写真なし"}
                />
                <PhotoBox label="チェックイン時の写真" photo={g.kioskPhoto} emptyText={g.checkedInAt ? "写真なし" : "未チェックイン"} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
