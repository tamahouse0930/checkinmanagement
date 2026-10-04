import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acquireCamera, releaseCamera } from "../kiosk/cameraStream";
import type { GuestText } from "../i18n/guest";

/**
 * 玄関のタブレットで身分証を撮るカメラ（要件定義書 T-05）。タブレットは固定されていて動かせないため、
 * ファイルの選択ではなく前面のカメラを画面の中で起動し、身分証をカメラに向けて撮る。
 * 両手で身分証を持てるよう、撮影ボタンの 3 秒後に撮る。写真は反転せず、カメラに写ったとおり（文字が読める向き）に表示・保存する
 */
export function IdCamera({ t, onCaptured, onClose }: { t: GuestText; onCaptured: (blob: Blob) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "ready" | "error">("starting");
  const [count, setCount] = useState<number | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    acquireCamera()
      .then((s) => {
        if (cancelled) return;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      if (video.current) video.current.srcObject = null;
      releaseCamera();
    };
  }, []);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const shoot = () => {
    let n = 3;
    setCount(n);
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
      canvas.toBlob((blob) => blob && setPhoto({ blob, url: URL.createObjectURL(blob) }), "image/jpeg", 0.92);
    }, 1000);
  };

  return createPortal(
    <div className="id-camera" role="dialog" aria-modal="true">
      <div className="id-camera-stage">
        <video ref={video} playsInline muted className={photo ? "hidden" : ""} />
        {photo && <img src={photo.url} alt="" />}
        {!photo && state === "ready" && <div className="id-frame" />}
        {count !== null && <div className="countdown">{count}</div>}
      </div>
      <p className="id-camera-guide">{state === "error" ? t.idCameraError : photo ? t.idCameraCheck : t.idCameraGuide}</p>
      <div className="id-camera-actions">
        {photo ? (
          <>
            <button type="button" className="button" onClick={() => setPhoto(null)}>
              {t.retakePhoto}
            </button>
            <button type="button" className="button primary" onClick={() => onCaptured(photo.blob)}>
              {t.idCameraUse}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button" onClick={onClose} disabled={count !== null}>
              {t.pickerCancel}
            </button>
            <button type="button" className="button primary" onClick={shoot} disabled={state !== "ready" || count !== null}>
              📷 {t.takePhoto}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
