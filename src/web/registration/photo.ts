/**
 * スマホで撮った写真を、長辺 1600px・JPEG 品質 0.8 に縮小する（設計書 4.3）。
 * Canvas で描き直すので、撮影場所などの情報（EXIF）も消える（要件定義書 S-10）
 */
export async function resizeImage(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/jpeg", quality),
  );
}
