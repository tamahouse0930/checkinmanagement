/**
 * ブラウザの識別情報（User-Agent）から、端末とブラウザの短い名前を作る（例: iPhone・Safari）。
 * 細かい違い（版など）は一覧の行にマウスを載せると全文で見られる
 */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "不明な端末";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : "その他の端末";
  const browser = /Line\//.test(ua)
    ? "LINE のブラウザ"
    : /GSA\//.test(ua)
      ? "Google アプリ"
      : /Gmail/.test(ua)
        ? "Gmail アプリ"
        : /EdgA?\/|EdgiOS\//.test(ua)
          ? "Edge"
          : /CriOS\/|Chrome\//.test(ua)
            ? "Chrome"
            : /FxiOS\/|Firefox\//.test(ua)
              ? "Firefox"
              : /Safari\//.test(ua)
                ? "Safari"
                : /iPhone|iPad/.test(ua)
                  ? "アプリ内のブラウザ・ホーム画面のアプリ"
                  : "ブラウザ";
  return `${device}・${browser}`;
}
