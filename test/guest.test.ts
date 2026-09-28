import { describe, expect, it } from "vitest";
import { EMPTY_GUEST, type GuestFields, missingFields, normalizeGuest } from "../src/shared/guest";
import { detectLang } from "../src/shared/langs";
import { DEFAULT_TEXTS, renderTemplate } from "../src/shared/templates";
import { deleteAfterFor, detectImageType, photoFileName } from "../src/worker/services/photos";
import { retentionCutoff } from "../src/worker/services/retention";

describe("3 年後の削除の境目（要件定義書 D-01）", () => {
  it("今日から 3 年前の日付より前にチェックアウトした予約が対象", () => {
    expect(retentionCutoff("2029-10-05")).toBe("2026-10-05");
    expect(retentionCutoff("2031-02-29")).toBe("2028-03-01");
  });

  it("写真の削除予定日と、名簿の削除の境目が同じ日になる", () => {
    const checkOut = "2026-10-05";
    // 削除予定日（チェックアウト日の 3 年後）の当日には、チェックアウト日は境目と同じになる
    expect(retentionCutoff(deleteAfterFor(checkOut))).toBe(checkOut);
  });
});

const japanese: GuestFields = {
  ...EMPTY_GUEST,
  isJapanese: true,
  fullName: "山田 太郎",
  addressCountry: "JP",
  address: "東京都多摩市",
  occupation: "会社員",
  contact: "090-1234-5678",
  idPhotoId: "p1",
};

const foreign: GuestFields = {
  ...EMPTY_GUEST,
  isJapanese: false,
  fullName: "KIM Minji",
  addressCountry: "KR",
  address: "Seoul",
  occupation: "Designer",
  contact: "minji@example.com",
  nationality: "KR",
  passportNumber: "M12345678",
  idPhotoId: "p2",
};

describe("名簿の入力チェック（要件定義書 6 章）", () => {
  it("日本人・日本人以外とも、必須項目がそろえば入力済み", () => {
    expect(missingFields(japanese)).toEqual([]);
    expect(missingFields(foreign)).toEqual([]);
  });

  it("日本人かどうかが未回答なら、それだけを求める", () => {
    expect(missingFields(EMPTY_GUEST)).toEqual(["isJapanese"]);
  });

  it("日本人以外は国籍とパスポート番号が必須（16 歳未満も）", () => {
    expect(missingFields({ ...foreign, nationality: "", passportNumber: "" })).toEqual(["nationality", "passportNumber"]);
    expect(missingFields({ ...foreign, isUnder16: true, idPhotoId: null })).toEqual(["idPhoto"]);
  });

  it("パスポート番号は英数字 6〜12 文字", () => {
    expect(missingFields({ ...foreign, passportNumber: "AB12" })).toEqual(["passportNumber"]);
    expect(missingFields({ ...foreign, passportNumber: "M1234-5678" })).toEqual(["passportNumber"]);
  });

  it("16 歳未満の日本人は身分証の写真を省略できる", () => {
    expect(missingFields({ ...japanese, idPhotoId: null })).toEqual(["idPhoto"]);
    expect(missingFields({ ...japanese, idPhotoId: null, isUnder16: true })).toEqual([]);
  });

  it("正規化: 日本人の国籍は JP、パスポート番号は大文字で空白なし", () => {
    expect(normalizeGuest({ ...japanese, nationality: "", passportNumber: "x" })).toMatchObject({ nationality: "JP", passportNumber: "" });
    expect(normalizeGuest({ ...foreign, passportNumber: " m1234 5678 " }).passportNumber).toBe("M12345678");
  });
});

describe("言語の自動選択（要件定義書 L-02）", () => {
  it.each([
    [["ja-JP"], "ja"],
    [["ko-KR"], "ko"],
    [["zh-CN"], "zh-Hans"],
    [["zh-TW"], "zh-Hant"],
    [["zh-Hant-HK"], "zh-Hant"],
    [["fr-FR", "en-US"], "en"],
    [["th-TH"], "en"],
  ] as const)("%o → %s", (prefs, expected) => {
    expect(detectLang(prefs)).toBe(expected);
  });
});

describe("案内文", () => {
  it("差し込みの値を入れ、知らない差し込みはそのまま残す", () => {
    expect(renderTemplate("{name} {url} {unknown}", { name: "TAMAHOUSE", url: "https://x" })).toBe("TAMAHOUSE https://x {unknown}");
    expect(renderTemplate(DEFAULT_TEXTS.code.ja, { code: "4821", checkin_date: "2026-10-03", checkin_time: "15:00" })).toContain("【4821】");
  });
});

describe("写真", () => {
  it("先頭のバイト列で画像の種類を判定する", () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("image/png");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(detectImageType(webp)).toBe("image/webp");
    expect(detectImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });

  it("ファイル名は 番号_氏名_種類（使えない文字を除き、空白は -）", () => {
    expect(photoFileName(1, "YAMADA Taro", "id", "image/jpeg")).toBe("01_YAMADA-Taro_id.jpg");
    expect(photoFileName(12, 'a/b:c*"d', "kiosk", "image/png")).toBe("12_abcd_kiosk.png");
    expect(photoFileName(2, null, "id", "image/jpeg")).toBe("02_guest_id.jpg");
  });

  it("削除予定日はチェックアウト日の 3 年後", () => {
    expect(deleteAfterFor("2026-10-05")).toBe("2029-10-05");
    expect(deleteAfterFor("2028-02-29")).toBe("2031-03-01");
  });
});
