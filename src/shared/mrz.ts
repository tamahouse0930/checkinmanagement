/**
 * パスポートの MRZ（顔写真のページの下にある 2 行の英数字。ICAO 9303 の TD3 形式）の解析（要件定義書 G-16）。
 * 文字認識（OCR）の読み間違いを補正し、チェック用の数字で読み取りが正しいかを確かめる
 */

const WEIGHTS = [7, 3, 1];

function charValue(ch: string): number {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return 0; // "<"
}

/** チェック用の数字を計算する（重み 7・3・1 の繰り返しで合計し、10 で割った余り） */
export function checkDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += charValue(field[i]) * WEIGHTS[i % 3];
  return sum % 10;
}

/** 数字であるべき位置で、文字認識が間違えやすい文字を数字に直す */
function toDigits(text: string): string {
  return text.replace(/[OQDU]/g, "0").replace(/[IL]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/G/g, "6").replace(/B/g, "8");
}

/** 文字であるべき位置で、文字認識が間違えやすい数字を文字に直す */
function toLetters(text: string): string {
  return text.replace(/0/g, "O").replace(/1/g, "I").replace(/2/g, "Z").replace(/5/g, "S").replace(/8/g, "B");
}

/** OCR の結果の 1 行を MRZ の文字（A〜Z、0〜9、<）だけにそろえる */
export function cleanLine(line: string): string {
  return line
    .toUpperCase()
    .replace(/[«‹〈＜]/g, "<")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9<]/g, "");
}

export interface MrzResult {
  passportNumber: string;
  /** 発行国・国籍（3 文字の国コード。例: KOR） */
  nationality3: string;
  surname: string;
  givenNames: string;
  /** 氏名の部分がきれいに読めたか（自動で入れてよいか） */
  namesClean: boolean;
  /** 旅券番号のチェック用の数字が合っているか */
  numberValid: boolean;
}

/**
 * 旅券番号の欄（9 文字）とチェック用の数字の組み合わせのうち、チェックが合うものを探す。
 * 旅券番号は英字と数字が混ざるため、特に読み間違えやすい文字（O と 0、I と 1 など）を 1 か所だけ入れ替えて試す。
 * 入れ替えの候補を広げすぎると、間違った番号が偶然チェックに合ってしまうため、候補を絞り、
 * 合う候補がちょうど 1 つのときだけ採用する
 */
function resolveNumber(field: string, check: string): { value: string; valid: boolean } {
  const digit = Number(toDigits(check));
  if (Number.isNaN(digit)) return { value: field, valid: false };
  if (checkDigit(field) === digit) return { value: field, valid: true };
  const swaps: Record<string, string[]> = { O: ["0"], "0": ["O"], D: ["0"], Q: ["0"], I: ["1"], "1": ["I"] };
  const matches: string[] = [];
  for (let i = 0; i < field.length; i++) {
    for (const alt of swaps[field[i]] ?? []) {
      const candidate = field.slice(0, i) + alt + field.slice(i + 1);
      if (checkDigit(candidate) === digit) matches.push(candidate);
    }
  }
  if (matches.length === 1) return { value: matches[0], valid: true };
  return { value: field, valid: false };
}

/**
 * OCR で読み取った文字列から MRZ を探して解析する。見つからなければ null。
 * 2 行目（旅券番号・国籍・生年月日・性別・有効期限）は、チェック用の数字が付いた位置で見つける
 */
export function parseMrz(ocrText: string): MrzResult | null {
  const lines = ocrText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length >= 30);
  if (lines.length === 0) return null;

  // 2 行目の候補: 生年月日（6 桁）＋チェック＋性別＋有効期限（6 桁）＋チェック の並びを含む行
  let best: { line2: string; index: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length < 28) continue;
    const birth = toDigits(l.slice(13, 19));
    const sex = l[20];
    if (/^\d{6}$/.test(birth) && /[MF<X]/.test(sex ?? "")) {
      best = { line2: l, index: i };
      break;
    }
  }
  // 見つからなければ、最後の長い行を 2 行目とみなす
  if (!best) best = { line2: lines[lines.length - 1], index: lines.length - 1 };

  const line2 = best.line2.padEnd(44, "<");
  const number = resolveNumber(line2.slice(0, 9).replace(/<+$/, (m) => m), line2[9]);
  const passportNumber = number.value.replace(/</g, "");
  const nationality3 = toLetters(line2.slice(10, 13)).replace(/</g, "");

  // 1 行目（P<発行国 姓<<名）: 2 行目の直前の行、または "P" で始まる行
  const line1 =
    (best.index > 0 ? lines[best.index - 1] : undefined) ?? lines.find((l) => l.startsWith("P")) ?? "";
  let surname = "";
  let givenNames = "";
  let namesClean = false;
  if (line1.startsWith("P")) {
    const names = toLetters(line1.slice(5));
    const [sur, given = ""] = names.split("<<");
    surname = sur.replace(/</g, " ").trim();
    givenNames = given.replace(/<+/g, " ").trim();
    // 空き部分の < は K や L と読み間違えやすい。形が崩れていない（姓<<名<<<… の形で、末尾が K・L の連続でない）ときだけ使う
    namesClean =
      /^[A-Z]+(<[A-Z]+)*(<<[A-Z]+(<[A-Z]+)*)?<*$/.test(names) && /<$|^.{39}$/.test(names) && !/[KL]{3,}<*$/.test(names);
  }

  if (passportNumber.length < 6) return null;
  return { passportNumber, nationality3, surname, givenNames, namesClean, numberValid: number.valid };
}

/** 3 文字の国コード（ISO 3166-1 alpha-3。MRZ で使う）を 2 文字の国コードに変える */
const ALPHA3_TO_2: Record<string, string> = Object.fromEntries(
  (
    "AFG:AF ALA:AX ALB:AL DZA:DZ ASM:AS AND:AD AGO:AO AIA:AI ATA:AQ ATG:AG ARG:AR ARM:AM ABW:AW AUS:AU AUT:AT AZE:AZ " +
    "BHS:BS BHR:BH BGD:BD BRB:BB BLR:BY BEL:BE BLZ:BZ BEN:BJ BMU:BM BTN:BT BOL:BO BES:BQ BIH:BA BWA:BW BVT:BV BRA:BR " +
    "IOT:IO BRN:BN BGR:BG BFA:BF BDI:BI CPV:CV KHM:KH CMR:CM CAN:CA CYM:KY CAF:CF TCD:TD CHL:CL CHN:CN CXR:CX CCK:CC " +
    "COL:CO COM:KM COG:CG COD:CD COK:CK CRI:CR CIV:CI HRV:HR CUB:CU CUW:CW CYP:CY CZE:CZ DNK:DK DJI:DJ DMA:DM DOM:DO " +
    "ECU:EC EGY:EG SLV:SV GNQ:GQ ERI:ER EST:EE SWZ:SZ ETH:ET FLK:FK FRO:FO FJI:FJ FIN:FI FRA:FR GUF:GF PYF:PF ATF:TF " +
    "GAB:GA GMB:GM GEO:GE DEU:DE D:DE GHA:GH GIB:GI GRC:GR GRL:GL GRD:GD GLP:GP GUM:GU GTM:GT GGY:GG GIN:GN GNB:GW " +
    "GUY:GY HTI:HT HMD:HM VAT:VA HND:HN HKG:HK HUN:HU ISL:IS IND:IN IDN:ID IRN:IR IRQ:IQ IRL:IE IMN:IM ISR:IL ITA:IT " +
    "JAM:JM JPN:JP JEY:JE JOR:JO KAZ:KZ KEN:KE KIR:KI PRK:KP KOR:KR KWT:KW KGZ:KG LAO:LA LVA:LV LBN:LB LSO:LS LBR:LR " +
    "LBY:LY LIE:LI LTU:LT LUX:LU MAC:MO MDG:MG MWI:MW MYS:MY MDV:MV MLI:ML MLT:MT MHL:MH MTQ:MQ MRT:MR MUS:MU MYT:YT " +
    "MEX:MX FSM:FM MDA:MD MCO:MC MNG:MN MNE:ME MSR:MS MAR:MA MOZ:MZ MMR:MM NAM:NA NRU:NR NPL:NP NLD:NL NCL:NC NZL:NZ " +
    "NIC:NI NER:NE NGA:NG NIU:NU NFK:NF MKD:MK MNP:MP NOR:NO OMN:OM PAK:PK PLW:PW PSE:PS PAN:PA PNG:PG PRY:PY PER:PE " +
    "PHL:PH PCN:PN POL:PL PRT:PT PRI:PR QAT:QA REU:RE ROU:RO RUS:RU RWA:RW BLM:BL SHN:SH KNA:KN LCA:LC MAF:MF SPM:PM " +
    "VCT:VC WSM:WS SMR:SM STP:ST SAU:SA SEN:SN SRB:RS SYC:SC SLE:SL SGP:SG SXM:SX SVK:SK SVN:SI SLB:SB SOM:SO ZAF:ZA " +
    "SGS:GS SSD:SS ESP:ES LKA:LK SDN:SD SUR:SR SJM:SJ SWE:SE CHE:CH SYR:SY TWN:TW TJK:TJ TZA:TZ THA:TH TLS:TL TGO:TG " +
    "TKL:TK TON:TO TTO:TT TUN:TN TUR:TR TKM:TM TCA:TC TUV:TV UGA:UG UKR:UA ARE:AE GBR:GB USA:US UMI:UM URY:UY UZB:UZ " +
    "VUT:VU VEN:VE VNM:VN VGB:VG VIR:VI WLF:WF ESH:EH YEM:YE ZMB:ZM ZWE:ZW RKS:XK GBD:GB GBN:GB GBO:GB GBS:GB GBP:GB"
  )
    .split(" ")
    .map((pair) => pair.split(":")),
);

export function alpha3ToAlpha2(code: string): string | null {
  return ALPHA3_TO_2[code] ?? null;
}

/** 旅券番号の比較用（大文字にし、空白と < を除く） */
export function normalizePassportNumber(value: string): string {
  return value.toUpperCase().replace(/[\s<]/g, "");
}

/**
 * 見た目が似ていて、チェック用の数字でも区別できない文字（L と 1、S と 8、G と 6）。
 * 写真から読み取った番号ではどちらか決められないため、比べるときは同じ文字とみなす
 */
const LOOKALIKE: Record<string, string> = { L: "1", S: "8", G: "6" };
const LOOKALIKE_PATTERN = /[LSG]/g;

/** 入力された旅券番号と、写真から読み取った番号が同じか（見分けられない文字の違いは同じとみなす） */
export function samePassportNumber(entered: string, mrz: string): boolean {
  const canon = (v: string) => normalizePassportNumber(v).replace(LOOKALIKE_PATTERN, (ch) => LOOKALIKE[ch]);
  return canon(entered) === canon(mrz);
}
