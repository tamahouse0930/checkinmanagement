import { useEffect, useState } from "react";
import { diffDays, formatDateJa } from "../../shared/dates";
import { CHANNEL_LABEL, type Channel } from "../../shared/progress";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

/**
 * 印刷・PDF 用の宿泊者名簿。行政（保健所など）から過去の宿泊者名簿を求められたときに、すぐ提示できるようにする。
 * ブラウザの印刷機能で、紙に印刷するか PDF に保存する
 */

interface RegisterGuest {
  seq: number;
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
  idPhotoId: string | null;
}

interface RegisterData {
  propertyName: string;
  from: string;
  to: string;
  stayedOnly: boolean;
  guestCount: number;
  stays: {
    reservationId: string;
    checkInDate: string;
    checkOutDate: string;
    channel: Channel;
    reservationCode: string | null;
    checkedOutAt: string | null;
    guests: RegisterGuest[];
  }[];
}

function formatTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

function countryName(code: string | null): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["ja"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function RegisterPrintPage() {
  const params = new URLSearchParams(location.search);
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [stayedOnly, setStayedOnly] = useState(params.get("stayed") !== "0");
  const [withCopies, setWithCopies] = useState(params.get("copies") !== "0");
  const [data, setData] = useState<RegisterData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<RegisterData>(`/api/admin/register?${new URLSearchParams({ from, to, stayed: stayedOnly ? "1" : "0" })}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to, stayedOnly]);

  const back = () => navigate(`/admin/photos?${new URLSearchParams({ from, to, name: "" })}`);

  return (
    <div className="stack register-print">
      <div className="no-print stack">
        <button className="link" onClick={back}>
          ← 名簿管理に戻る
        </button>
        <section className="card">
          <div className="actions print-options">
            <label className="check">
              <input type="checkbox" checked={stayedOnly} onChange={(e) => setStayedOnly(e.target.checked)} />
              チェックインした人（宿泊した人）だけ
            </label>
            <label className="check">
              <input type="checkbox" checked={withCopies} onChange={(e) => setWithCopies(e.target.checked)} />
              パスポート・身分証の写しを含める
            </label>
            <button className="button primary" onClick={() => window.print()} disabled={!data}>
              印刷・PDFで保存
            </button>
          </div>
          <p className="note">「印刷・PDFで保存」を押すと印刷の画面が開きます。PDF にする場合は、送信先（プリンター）で「PDF に保存」を選んでください。</p>
        </section>
      </div>

      {error && <p className="alert">{error}</p>}
      {!data && !error && <p className="note">読み込み中…</p>}

      {data && (
        <article className="register-sheet">
          <header>
            <h1>宿泊者名簿</h1>
            <p>
              施設: {data.propertyName} ／ 期間: {formatDateJa(data.from)} 〜 {formatDateJa(data.to)}（宿泊日が重なる予約）／{" "}
              {data.stayedOnly ? "チェックインした宿泊者" : "登録された宿泊者（未チェックインを含む）"} {data.guestCount}人
            </p>
            <p>出力日時: {formatTime(new Date().toISOString())}</p>
          </header>

          {data.stays.length === 0 && <p>該当する宿泊者はいません。</p>}

          {data.stays.map((s) => (
            <section key={s.reservationId} className="register-stay">
              <h2>
                {formatDateJa(s.checkInDate)} 〜 {formatDateJa(s.checkOutDate)}（{diffDays(s.checkInDate, s.checkOutDate)}泊）／{" "}
                {CHANNEL_LABEL[s.channel]}
                {s.reservationCode && ` ${s.reservationCode}`}
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>氏名</th>
                    <th>国籍</th>
                    <th>旅券番号</th>
                    <th>住所</th>
                    <th>連絡先</th>
                    <th>職業</th>
                    <th>チェックイン</th>
                  </tr>
                </thead>
                <tbody>
                  {s.guests.map((g) => (
                    <tr key={g.seq}>
                      <td>{g.seq}</td>
                      <td>
                        {g.fullName}
                        {g.isUnder16 && <small>（16歳未満）</small>}
                      </td>
                      <td>{g.isJapanese ? "日本" : countryName(g.nationality)}</td>
                      <td>{g.isJapanese ? "" : g.passportNumber}</td>
                      <td>
                        {g.addressCountry && g.addressCountry !== "JP" ? `${countryName(g.addressCountry)} ` : ""}
                        {g.address}
                      </td>
                      <td>{g.contact}</td>
                      <td>{g.occupation}</td>
                      <td>{formatTime(g.checkedInAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {withCopies && s.guests.some((g) => g.idPhotoId) && (
                <div className="register-copies">
                  {s.guests
                    .filter((g) => g.idPhotoId)
                    .map((g) => (
                      <figure key={g.seq}>
                        <img src={`/api/admin/photos/${g.idPhotoId}`} alt="" />
                        <figcaption>
                          {g.seq}. {g.fullName}（{g.isJapanese === false ? "パスポートの写し" : "身分証の写し"}）
                        </figcaption>
                      </figure>
                    ))}
                </div>
              )}
              <p className="register-foot">チェックアウト: {formatTime(s.checkedOutAt)}</p>
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
