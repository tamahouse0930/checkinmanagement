import { type MrzResult, parseMrz } from "../../shared/mrz";

/**
 * パスポートの写真から MRZ を読み取る（要件定義書 G-16）。読み取りはゲストのスマホの中で行い、
 * 写真を外部の読み取りサービスには送らない。ライブラリは、パスポートを撮影したときにだけ読み込む
 */

const MRZ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

/**
 * 写真の一部を切り出し、白黒にしてコントラストを上げたキャンバスを作る。
 * top・height は写真の高さに対する割合（例: 0.6, 0.4 → 下から 4 割）
 */
async function crop(blob: Blob, top: number, height: number, width = 1600): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const sy = Math.round(bitmap.height * top);
  const sh = Math.round(bitmap.height * height);
  const scale = width / bitmap.width;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, sy, bitmap.width, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // 文字（黒）と地（明るい色）をはっきり分ける
    const v = gray < 110 ? 0 : gray > 170 ? 255 : Math.round(((gray - 110) / 60) * 255);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export async function readPassport(blob: Blob): Promise<MrzResult | null> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({ tessedit_char_whitelist: MRZ_CHARS, tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    let fallback: MrzResult | null = null;
    // MRZ は顔写真のページの下にある。まず下の方だけを読み、だめなら写真全体を読む
    for (const [top, height] of [
      [0.55, 0.45],
      [0.35, 0.65],
      [0, 1],
    ] as const) {
      const { data } = await worker.recognize(await crop(blob, top, height));
      const result = parseMrz(data.text);
      if (result?.numberValid) return result;
      fallback ??= result;
    }
    return fallback;
  } finally {
    await worker.terminate();
  }
}
