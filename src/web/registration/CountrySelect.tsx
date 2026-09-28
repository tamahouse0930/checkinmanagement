import { useMemo } from "react";
import { COUNTRY_CODES } from "../../shared/countries";
import type { Lang } from "../../shared/langs";

function displayNames(lang: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([lang], { type: "region" });
  } catch {
    return null;
  }
}

/** 国・地域の一覧。英語表記のアルファベット順に並べ、選んだ言語の国名を併記する（要件定義書 L-08） */
export function CountrySelect(props: { lang: Lang; value: string; placeholder: string; onChange: (code: string) => void; disabled?: boolean }) {
  const options = useMemo(() => {
    const en = displayNames("en");
    const local = props.lang === "en" ? null : displayNames(props.lang);
    return COUNTRY_CODES.map((code) => {
      const enName = en?.of(code) ?? code;
      const localName = local?.of(code);
      return { code, enName, label: localName && localName !== enName ? `${enName} / ${localName}` : enName };
    }).sort((a, b) => a.enName.localeCompare(b.enName, "en"));
  }, [props.lang]);

  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} disabled={props.disabled}>
      <option value="">{props.placeholder}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
