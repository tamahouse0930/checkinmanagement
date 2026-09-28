import { describe, expect, it } from "vitest";
import { alpha3ToAlpha2, checkDigit, parseMrz, samePassportNumber } from "../src/shared/mrz";

// ICAO 9303 の見本のパスポートの MRZ
const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

describe("MRZ のチェック用の数字", () => {
  it("見本のパスポートの各欄のチェック用の数字が合う", () => {
    expect(checkDigit("L898902C3")).toBe(6);
    expect(checkDigit("740812")).toBe(2);
    expect(checkDigit("120415")).toBe(9);
  });
});

describe("MRZ の解析", () => {
  it("見本のパスポートから旅券番号・国籍・氏名を読み取る", () => {
    expect(parseMrz(`${LINE1}\n${LINE2}`)).toEqual({
      passportNumber: "L898902C3",
      nationality3: "UTO",
      surname: "ERIKSSON",
      givenNames: "ANNA MARIA",
      namesClean: true,
      numberValid: true,
    });
  });

  it("空き部分の < を K や L と読み間違えた氏名は、自動で入れない（namesClean が false）", () => {
    // 実際に Tesseract で読み取ったときの結果
    const garbled = "P<UTOERIKSSONKKANNAKMARTIALLLLLLLLLLLLLLLLLLKL";
    expect(parseMrz(`${garbled}\n${LINE2}`)?.namesClean).toBe(false);
  });

  it("前後に余計な文字（写真の他の部分の読み取り結果）があっても 2 行を見つける", () => {
    const noisy = `PASSPORT\nREPUBLIC OF UTOPIA\n${LINE1}\n${LINE2}\n`;
    expect(parseMrz(noisy)?.passportNumber).toBe("L898902C3");
  });

  it("空白や « などの読み間違いを直す", () => {
    const text = `P«UTOERIKSSON««ANNA«MARIA««««««««««««««««««««\nL898902C3 6UTO7408122F1204159ZE184226B<<<<<10`;
    expect(parseMrz(text)).toMatchObject({ passportNumber: "L898902C3", numberValid: true });
  });

  it("旅券番号の中の読み間違い（0 と O など）を、チェック用の数字を使って直す", () => {
    // 正しくは C3 だが、O と 0 のように読み間違えやすい例: L898902C3 の 0 を O と読んだ場合
    const wrong = LINE2.replace("L898902C3", "L8989O2C3");
    expect(parseMrz(`${LINE1}\n${wrong}`)).toMatchObject({ passportNumber: "L898902C3", numberValid: true });
  });

  it("チェック用の数字が合わない場合は、読み取った値を返しつつ numberValid を false にする", () => {
    const wrong = LINE2.replace("L898902C36", "L898902C37");
    expect(parseMrz(`${LINE1}\n${wrong}`)?.numberValid).toBe(false);
  });

  it("MRZ が見つからなければ null", () => {
    expect(parseMrz("")).toBeNull();
    expect(parseMrz("PASSPORT\nJAPAN")).toBeNull();
  });
});

describe("旅券番号の照合", () => {
  it("同じ番号は一致（大文字・小文字や空白の違いは無視）", () => {
    expect(samePassportNumber("l898902c3", "L898902C3")).toBe(true);
    expect(samePassportNumber("L898 902C3", "L898902C3")).toBe(true);
  });

  it("写真からは見分けられない文字（L と 1、S と 8、G と 6）の違いは一致とみなす", () => {
    // L と 1 はチェック用の数字も同じになるため、写真から読んだ番号では区別できない
    expect(checkDigit("1898902C3")).toBe(checkDigit("L898902C3"));
    expect(samePassportNumber("L898902C3", "1898902C3")).toBe(true);
    expect(samePassportNumber("S12345G78", "812345678")).toBe(true);
  });

  it("それ以外の違いは不一致", () => {
    expect(samePassportNumber("L898902C4", "L898902C3")).toBe(false);
    expect(samePassportNumber("L89890C3", "L898902C3")).toBe(false);
  });
});

describe("国コード", () => {
  it("3 文字の国コードを 2 文字に変える（ドイツの D も）", () => {
    expect(alpha3ToAlpha2("KOR")).toBe("KR");
    expect(alpha3ToAlpha2("TWN")).toBe("TW");
    expect(alpha3ToAlpha2("D")).toBe("DE");
    expect(alpha3ToAlpha2("XXX")).toBeNull();
  });
});
