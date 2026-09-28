/**
 * 玄関タブレットのカメラ。撮影のたびに起動し直すと、ブラウザによっては毎回許可を求められるため、
 * 一度起動したカメラを使い回す。5 分間使われなければ止める（カメラのランプを点けたままにしないため）
 */

const IDLE_STOP_MS = 5 * 60 * 1000;

let stream: MediaStream | null = null;
let pending: Promise<MediaStream> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function isLive(s: MediaStream | null): s is MediaStream {
  return !!s && s.getVideoTracks().some((track) => track.readyState === "live");
}

/** カメラを取得する（起動済みならそれを返す） */
export async function acquireCamera(): Promise<MediaStream> {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  if (isLive(stream)) return stream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera_unavailable");
  pending ??= navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
    .then((s) => {
      stream = s;
      return s;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** 撮影画面を閉じたときに呼ぶ。すぐには止めず、5 分間使われなければ止める */
export function releaseCamera(): void {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    stopTimer = null;
  }, IDLE_STOP_MS);
}
