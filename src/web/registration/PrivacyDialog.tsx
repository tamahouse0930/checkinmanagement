import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Lang } from "../../shared/langs";
import { PolicyBody, policyText } from "../public/PrivacyPage";
import { usePublicInfo } from "../public/usePublicInfo";

/**
 * 個人情報の取り扱いを、入力画面の上に重ねて表示する。別のタブで開かないので、
 * 「閉じる」で入力の続きに戻れる（玄関のタブレットでも画面の外に出ない）。
 * 選んだ言語の文面がなければ英語、それもなければ日本語で表示する
 */
function PrivacyDialog({ lang, closeLabel, onClose }: { lang: Lang; closeLabel: string; onClose: () => void }) {
  const info = usePublicInfo();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shownLang: Lang | null = info ? ([lang, "en", "ja"] as Lang[]).find((l) => policyText(info, l).trim()) ?? null : null;

  return (
    <div className="policy-overlay" role="dialog" aria-modal="true">
      <div className="policy-bar">
        <button type="button" className="button primary" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
      <div className="policy-body doc">
        {!info ? <p className="note">…</p> : shownLang && <PolicyBody info={info} lang={shownLang} text={policyText(info, shownLang)} />}
        <div className="actions">
          <button type="button" className="button" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 「個人情報の取り扱いを読む」のリンク。押すと上に重ねて表示する */
export function PrivacyLink({ lang, label, closeLabel }: { lang: Lang; label: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href="/privacy"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        {label}
      </a>
      {/* 同意のチェックボックスのラベルや、無効にした入力欄の中に置かれても影響を受けないよう、body の直下に出す */}
      {open && createPortal(<PrivacyDialog lang={lang} closeLabel={closeLabel} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
