import { Fragment } from "react";
import { LANGS, type Lang } from "../../shared/langs";
import { DEFAULT_PRIVACY, parsePolicy, PRIVACY_CONTACT_FALLBACK } from "../../shared/privacy";
import { renderTemplate } from "../../shared/templates";
import { usePublicInfo } from "./usePublicInfo";

/**
 * 個人情報の取り扱い（要件定義書 付録 A）。管理画面の「文面」で言語ごとに書き換えられる。
 * 日本語と英語は、書き換えていなければ既定の文面を出す。ほかの言語は、書き換えた文面があれば続けて出す
 */
export function PrivacyPage() {
  const info = usePublicInfo();
  if (!info) return <main className="doc">読み込み中… / Loading…</main>;

  const shown = LANGS.map((lang) => ({ lang, text: info.privacy[lang] ?? DEFAULT_PRIVACY[lang] ?? "" })).filter((s) => s.text.trim());
  const values = (lang: Lang) => ({
    name: info.name,
    operator: info.operatorName || info.name,
    contact: info.operatorContact || PRIVACY_CONTACT_FALLBACK[lang],
  });

  return (
    <main className="doc">
      {shown.map(({ lang, text }, i) => (
        <Fragment key={lang}>
          {i > 0 && <hr />}
          <section lang={lang}>
            {parsePolicy(renderTemplate(text, values(lang))).map((block, j) =>
              block.type === "h1" ? (
                <h1 key={j}>{block.text}</h1>
              ) : block.type === "h2" ? (
                <h2 key={j}>{block.text}</h2>
              ) : block.type === "ul" ? (
                <ul key={j}>
                  {block.items.map((item, k) => (
                    <li key={k}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={j} className="pre">
                  {block.text}
                </p>
              ),
            )}
          </section>
        </Fragment>
      ))}
      <p>
        <a href="/">{info.name}</a>
      </p>
    </main>
  );
}
