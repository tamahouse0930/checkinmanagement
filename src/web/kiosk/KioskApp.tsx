import { useCallback, useEffect, useRef, useState } from "react";
import { LANG_NAME, LANGS, type Lang } from "../../shared/langs";
import { fill } from "../i18n/guest";
import { KIOSK_TEXT, type KioskText } from "../i18n/kiosk";
import { resizeImage } from "../registration/photo";

/** 玄関タブレットの画面（要件定義書 5.4、設計書 4.6） */

const IDLE_MS = 60_000;
const DONE_MS = 15_000;

type Screen =
  | { kind: "loading" }
  | { kind: "pair" }
  | { kind: "error" }
  | { kind: "lang" }
  | { kind: "menu" }
  | { kind: "checkin" }
  | { kind: "camera"; guestId: string; name: string }
  | { kind: "checkedIn"; name: string; allDone: boolean }
  | { kind: "notListed" }
  | { kind: "checkout" }
  | { kind: "confirmCheckout"; reservationId: string; name: string }
  | { kind: "checkedOut" }
  | { kind: "notCheckedIn" };

interface Status {
  propertyName: string;
  testMode: boolean;
  hostContact: Record<Lang, string>;
}

class KioskError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

const testMode = new URLSearchParams(location.search).get("mode") === "test";

async function kioskApi<T>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const headers: Record<string, string> = testMode ? { "X-Kiosk-Mode": "test" } : {};
  let body: BodyInit | undefined;
  if (init?.form) body = init.form;
  else if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api/kiosk${path}`, { method: init?.method ?? "GET", headers, body, credentials: "same-origin" });
  if (!res.ok) throw new KioskError(res.status);
  return res.json() as Promise<T>;
}

/** 余計な操作の防止（要件定義書 T-10）: 拡大・長押しメニュー・ブラウザの戻る操作を無効にし、全画面で起動できるようにする */
function useLockdown() {
  useEffect(() => {
    const viewport = document.querySelector('meta[name="viewport"]');
    const previous = viewport?.getAttribute("content");
    viewport?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");

    const added: HTMLElement[] = [];
    const addHead = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      document.head.appendChild(el);
      added.push(el);
    };
    addHead("link", { rel: "manifest", href: "/kiosk.webmanifest" });
    addHead("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    addHead("meta", { name: "mobile-web-app-capable", content: "yes" });

    document.body.classList.add("kiosk-body");
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", prevent);
    document.addEventListener("gesturestart", prevent);
    document.addEventListener("dragstart", prevent);
    history.pushState(null, "", location.href);
    const onPop = () => history.pushState(null, "", location.href);
    window.addEventListener("popstate", onPop);

    return () => {
      if (previous) viewport?.setAttribute("content", previous);
      added.forEach((el) => el.remove());
      document.body.classList.remove("kiosk-body");
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("dragstart", prevent);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
}

// ---- カメラ ----

function Camera(props: { t: KioskText; name: string; onCaptured: (blob: Blob) => Promise<boolean>; onBack: () => void }) {
  const { t } = props;
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [state, setState] = useState<"starting" | "ready" | "error" | "saving" | "failed">("starting");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((track) => track.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        setState("ready");
      })
      .catch(() => setState("error"));
    if (!navigator.mediaDevices) setState("error");
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // 3 秒のカウントダウンの後に撮影する
  const start = () => {
    setCount(3);
    let n = 3;
    const timer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        return;
      }
      clearInterval(timer);
      setCount(null);
      const v = video.current;
      if (!v || !v.videoWidth) return;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")!.drawImage(v, 0, 0);
      canvas.toBlob(async (raw) => {
        if (!raw) return;
        const blob = await resizeImage(raw, 1280, 0.85);
        setPhoto({ blob, url: URL.createObjectURL(blob) });
      }, "image/jpeg", 0.92);
    }, 1000);
  };

  const retake = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setState("ready");
  };

  const accept = async () => {
    if (!photo) return;
    setState("saving");
    const ok = await props.onCaptured(photo.blob);
    // 保存した写真はタブレットに残さない
    URL.revokeObjectURL(photo.url);
    if (!ok) {
      setPhoto(null);
      setState("failed");
    }
  };

  return (
    <div className="kiosk-camera">
      <h2>{props.name}</h2>
      <div className="camera-stage">
        <video ref={video} playsInline muted className={photo ? "hidden" : ""} />
        {photo && <img src={photo.url} alt="" />}
        {!photo && <div className="face-frame" />}
        {count !== null && <div className="countdown">{count}</div>}
      </div>
      <p className="kiosk-guide">{photo ? t.confirmPhoto : state === "error" ? t.cameraError : t.cameraGuide}</p>
      <p className="kiosk-small">{t.cameraNotice}</p>
      {state === "failed" && <p className="kiosk-alert">{t.saveFailed}</p>}
      <div className="kiosk-actions">
        {photo ? (
          <>
            <button className="kbtn" onClick={retake} disabled={state === "saving"}>
              {t.retake}
            </button>
            <button className="kbtn primary" onClick={accept} disabled={state === "saving"}>
              {state === "saving" ? t.saving : t.usePhoto}
            </button>
          </>
        ) : (
          <>
            <button className="kbtn" onClick={props.onBack} disabled={count !== null}>
              {t.back}
            </button>
            <button className="kbtn primary" onClick={start} disabled={state !== "ready" && state !== "failed" || count !== null}>
              📷
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---- 全体 ----

export function KioskApp() {
  useLockdown();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [lang, setLang] = useState<Lang>("ja");
  const [status, setStatus] = useState<Status | null>(null);
  const [guests, setGuests] = useState<{ guestId: string; name: string; done: boolean; isTest: boolean }[]>([]);
  const [stays, setStays] = useState<{ reservationId: string; name: string; isTest: boolean }[]>([]);
  const [pairCode, setPairCode] = useState("");
  const [pairError, setPairError] = useState(false);
  const t = KIOSK_TEXT[lang];

  const toLanguage = useCallback(() => setScreen({ kind: "lang" }), []);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await kioskApi<Status>("/status"));
      setScreen({ kind: "lang" });
    } catch (e) {
      setScreen(e instanceof KioskError && e.status === 401 && !testMode ? { kind: "pair" } : { kind: "error" });
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // 60 秒操作がなければ最初の画面に戻る。完了画面は 15 秒で戻る（要件定義書 T-10）
  useEffect(() => {
    if (["lang", "loading", "pair", "error"].includes(screen.kind)) return;
    const doneScreens = ["checkedIn", "checkedOut", "notListed"];
    const ms = doneScreens.includes(screen.kind) ? DONE_MS : IDLE_MS;
    let timer = setTimeout(toLanguage, ms);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(toLanguage, ms);
    };
    const events = ["pointerdown", "keydown"];
    if (!doneScreens.includes(screen.kind)) events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [screen, toLanguage]);

  const openCheckin = async () => {
    try {
      setGuests((await kioskApi<{ guests: typeof guests }>("/checkin")).guests);
      setScreen({ kind: "checkin" });
    } catch {
      setScreen({ kind: "error" });
    }
  };

  const openCheckout = async () => {
    try {
      const list = (await kioskApi<{ reservations: typeof stays }>("/checkout")).reservations;
      setStays(list);
      if (list.length === 0) setScreen({ kind: "notCheckedIn" });
      else if (list.length === 1) setScreen({ kind: "confirmCheckout", ...list[0] });
      else setScreen({ kind: "checkout" });
    } catch {
      setScreen({ kind: "error" });
    }
  };

  const uploadPhoto = async (guestId: string, name: string, blob: Blob): Promise<boolean> => {
    const form = new FormData();
    form.append("file", blob, "kiosk.jpg");
    try {
      const res = await kioskApi<{ allDone: boolean }>(`/guests/${guestId}/photo`, { method: "POST", form });
      setScreen({ kind: "checkedIn", name, allDone: res.allDone });
      return true;
    } catch {
      return false;
    }
  };

  const checkout = async (reservationId: string) => {
    try {
      await kioskApi(`/reservations/${reservationId}/checkout`, { method: "POST" });
      setScreen({ kind: "checkedOut" });
    } catch {
      setScreen({ kind: "error" });
    }
  };

  const pair = async () => {
    setPairError(false);
    try {
      await kioskApi("/pair", { method: "POST", body: { code: pairCode } });
      await loadStatus();
    } catch {
      setPairError(true);
    }
  };

  const backButton = (onClick: () => void) => (
    <button className="kbtn small back" onClick={onClick}>
      ← {t.back}
    </button>
  );

  let content: React.ReactNode;
  switch (screen.kind) {
    case "loading":
      content = <p className="kiosk-guide">…</p>;
      break;
    case "error":
      content = (
        <div className="kiosk-center">
          <p className="kiosk-alert">Error</p>
          <button className="kbtn" onClick={loadStatus}>
            ↻
          </button>
        </div>
      );
      break;
    case "pair":
      content = (
        <div className="kiosk-center">
          <h1>{KIOSK_TEXT.ja.pairTitle}</h1>
          <p className="kiosk-small">{KIOSK_TEXT.ja.pairBody}</p>
          <input
            className="pair-input"
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            maxLength={8}
          />
          {pairError && <p className="kiosk-alert">{KIOSK_TEXT.ja.pairFailed}</p>}
          <button className="kbtn primary" onClick={pair} disabled={pairCode.length !== 8}>
            {KIOSK_TEXT.ja.pairButton}
          </button>
        </div>
      );
      break;
    case "lang":
      content = (
        <div className="kiosk-center">
          <h1>{status?.propertyName}</h1>
          <p className="kiosk-guide">Welcome ・ ようこそ ・ 환영합니다 ・ 欢迎 ・ 歡迎</p>
          <div className="kiosk-grid langs">
            {LANGS.map((l) => (
              <button
                key={l}
                className="kbtn big"
                onClick={() => {
                  setLang(l);
                  setScreen({ kind: "menu" });
                }}
              >
                {LANG_NAME[l]}
              </button>
            ))}
          </div>
        </div>
      );
      break;
    case "menu":
      content = (
        <div className="kiosk-center">
          {backButton(toLanguage)}
          <h1>{status?.propertyName}</h1>
          <div className="kiosk-grid two">
            <button className="kbtn huge primary" onClick={openCheckin}>
              {t.checkIn}
            </button>
            <button className="kbtn huge" onClick={openCheckout}>
              {t.checkOut}
            </button>
          </div>
        </div>
      );
      break;
    case "checkin":
      content = (
        <div className="kiosk-center">
          {backButton(() => setScreen({ kind: "menu" }))}
          <h2>{guests.length > 0 ? t.tapYourName : t.noCheckinToday}</h2>
          <div className="kiosk-grid names">
            {guests.map((g) => (
              <button
                key={g.guestId}
                className={`kbtn name${g.done ? " done" : ""}`}
                disabled={g.done}
                onClick={() => setScreen({ kind: "camera", guestId: g.guestId, name: g.name })}
              >
                {g.name}
                {g.isTest && <span className="test-mark">テスト</span>}
                {g.done && <span className="done-mark">✓ {t.done}</span>}
              </button>
            ))}
          </div>
          <button className="kbtn small" onClick={() => setScreen({ kind: "notListed" })}>
            {t.notListed}
          </button>
        </div>
      );
      break;
    case "camera":
      content = (
        <Camera
          t={t}
          name={screen.name}
          onCaptured={(blob) => uploadPhoto(screen.guestId, screen.name, blob)}
          onBack={() => setScreen({ kind: "checkin" })}
        />
      );
      break;
    case "checkedIn":
      content = (
        <div className="kiosk-center">
          <div className="kiosk-check">✓</div>
          <h2>{fill(t.checkedIn, { name: screen.name })}</h2>
          <p className="kiosk-guide">{screen.allDone ? t.allCheckedIn : t.othersRemaining}</p>
          {!screen.allDone && (
            <button className="kbtn primary" onClick={openCheckin}>
              {t.checkIn}
            </button>
          )}
        </div>
      );
      break;
    case "notListed":
      content = (
        <div className="kiosk-center">
          <h2>{t.notListedTitle}</h2>
          <p className="kiosk-guide">{t.notListedBody}</p>
          {status?.hostContact[lang] && <p className="kiosk-contact">{status.hostContact[lang]}</p>}
          <button className="kbtn" onClick={() => setScreen({ kind: "checkin" })}>
            {t.back}
          </button>
        </div>
      );
      break;
    case "checkout":
      content = (
        <div className="kiosk-center">
          {backButton(() => setScreen({ kind: "menu" }))}
          <h2>{t.chooseReservation}</h2>
          <div className="kiosk-grid names">
            {stays.map((s) => (
              <button key={s.reservationId} className="kbtn name" onClick={() => setScreen({ kind: "confirmCheckout", ...s })}>
                {s.name}
                {s.isTest && <span className="test-mark">テスト</span>}
              </button>
            ))}
          </div>
        </div>
      );
      break;
    case "confirmCheckout":
      content = (
        <div className="kiosk-center">
          <p className="kiosk-small">{screen.name}</p>
          <h2>{t.confirmCheckout}</h2>
          <div className="kiosk-grid two">
            <button className="kbtn huge primary" onClick={() => checkout(screen.reservationId)}>
              {t.yes}
            </button>
            <button className="kbtn huge" onClick={() => setScreen({ kind: "menu" })}>
              {t.no}
            </button>
          </div>
        </div>
      );
      break;
    case "checkedOut":
      content = (
        <div className="kiosk-center">
          <h2>{t.checkedOut}</h2>
          <div className="key-reminder">
            <span className="key-icon">🔑</span>
            {t.returnKey}
          </div>
          <p className="kiosk-guide">{t.thanks}</p>
        </div>
      );
      break;
    case "notCheckedIn":
      content = (
        <div className="kiosk-center">
          {backButton(() => setScreen({ kind: "menu" }))}
          <h2>{t.notCheckedIn}</h2>
          <button className="kbtn huge primary" onClick={openCheckin}>
            {t.goToCheckin}
          </button>
        </div>
      );
      break;
  }

  return (
    <div className="kiosk" lang={lang}>
      {testMode && <div className="kiosk-test">{KIOSK_TEXT.ja.testMode}</div>}
      {content}
    </div>
  );
}
