/** 対応言語（要件定義書 L-01）。言語を増やすときはここと画面の辞書に追加する */
export const LANGS = ["ja", "en", "ko", "zh-Hans", "zh-Hant"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAME: Record<Lang, string> = {
  ja: "日本語",
  en: "English",
  ko: "한국어",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** ブラウザの言語設定から対応言語を選ぶ。対応していなければ英語（要件定義書 L-02） */
export function detectLang(preferred: readonly string[]): Lang {
  for (const raw of preferred) {
    const tag = raw.toLowerCase();
    if (tag.startsWith("ja")) return "ja";
    if (tag.startsWith("ko")) return "ko";
    if (tag.startsWith("zh")) {
      return tag.includes("hant") || tag.includes("-tw") || tag.includes("-hk") || tag.includes("-mo") ? "zh-Hant" : "zh-Hans";
    }
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}
