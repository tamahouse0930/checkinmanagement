import { useEffect, useState } from "react";
import { diffDays } from "../../shared/dates";
import { detectLang, isLang, LANG_NAME, LANGS, type Lang } from "../../shared/langs";
import { fill, GUEST_TEXT } from "../i18n/guest";
import { useDocumentTitle } from "../lib/title";

/**
 * 同行者の皆さんに送る共通のリンク（/j/:token。要件定義書 G-11）。
 * ボタンを押すと空いている枠を 1 つ割り当て、その人専用の入力画面（/g/:token）に移る。
 * リンクを開いただけでは割り当てない（チャットのプレビューなどで枠が埋まらないように）。
 * この端末で開いた入力画面は覚えておき、もう一度開けるようにする（家族の分を同じスマホで入力する場合もあるため、新しく割り当てることもできる）
 */

interface GroupView {
  property: { name: string; checkinTime: string; checkoutTime: string };
  checkInDate: string;
  checkOutDate: string;
  isTest: boolean;
  open: number;
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

const storageKey = (token: string) => `th_group:${token}`;

function loadOpened(token: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(token)) ?? "[]");
    return Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.startsWith("/g/")) : [];
  } catch {
    return [];
  }
}

function saveOpened(token: string, urls: string[]): void {
  try {
    localStorage.setItem(storageKey(token), JSON.stringify(urls));
  } catch {
    // 覚えておけなくても入力はできる
  }
}

export function GroupApp({ token }: { token: string }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [view, setView] = useState<GroupView | null>(null);
  const [failure, setFailure] = useState<"invalid" | "error" | "full" | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened] = useState(() => loadOpened(token));
  const t = GUEST_TEXT[lang];
  useDocumentTitle(view?.property.name);

  const call = async <T,>(path: string, method = "GET"): Promise<{ status: number; data: T | null }> => {
    const res = await fetch(`/api/j${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  };

  useEffect(() => {
    call<GroupView>("")
      .then(({ status, data }) => (data ? setView(data) : setFailure(status === 404 ? "invalid" : "error")))
      .catch(() => setFailure("error"));
  }, [token]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("th_lang", l);
    } catch {
      // 保存できなくても表示は切り替わる
    }
  };

  const claim = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const { status, data } = await call<{ url: string }>("/claim", "POST");
      if (!data) {
        setFailure(status === 409 ? "full" : status === 404 ? "invalid" : "error");
        return;
      }
      const path = new URL(data.url).pathname;
      saveOpened(token, [...opened, path]);
      location.assign(path);
    } catch {
      setFailure("error");
    } finally {
      setBusy(false);
    }
  };

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

  if (failure === "invalid" || failure === "error" || !view) {
    return (
      <div className="reg">
        {header}
        <main className="reg-main">
          {failure ? <p className="alert">{failure === "invalid" ? t.invalidUrl : t.errorGeneric}</p> : <p className="note">{t.loading}</p>}
        </main>
      </div>
    );
  }

  const full = failure === "full" || view.open === 0;

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
          <div className="arrow">→ {fill(t.nights, { n: diffDays(view.checkInDate, view.checkOutDate) })} →</div>
          <div>
            <small>{t.checkOut}</small>
            <strong>{formatDate(view.checkOutDate, lang)}</strong>
            <small>〜{view.property.checkoutTime}</small>
          </div>
        </section>

        <p>{fill(t.groupIntro, { name: view.property.name })}</p>

        <section className="card group-actions">
          {opened.map((path, i) => (
            <a key={path} className="button" href={path}>
              {fill(t.groupResume, { n: i + 1 })}
            </a>
          ))}
          {full ? (
            <p className="note">{t.groupFull}</p>
          ) : (
            <button className="button primary" onClick={claim} disabled={busy}>
              {opened.length > 0 ? t.groupAnother : t.groupStart}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
