import type { Lang } from "./langs";

/**
 * 職業の選択肢（要件定義書 G-05）。保存する値は日本語の名称（管理画面・名簿の CSV でそのまま読めるように）。
 * どれにも当たらなければ「その他」を選び、自由に入力する（入力した文字をそのまま保存する）
 */
export const OCCUPATIONS: { ja: string; label: Record<Lang, string> }[] = [
  { ja: "会社員", label: { ja: "会社員", en: "Company employee", ko: "회사원", "zh-Hans": "公司职员", "zh-Hant": "公司職員" } },
  { ja: "会社役員", label: { ja: "会社役員", en: "Company executive", ko: "회사 임원", "zh-Hans": "公司高管", "zh-Hant": "公司主管" } },
  { ja: "公務員", label: { ja: "公務員", en: "Public servant", ko: "공무원", "zh-Hans": "公务员", "zh-Hant": "公務員" } },
  { ja: "自営業", label: { ja: "自営業", en: "Self-employed", ko: "자영업", "zh-Hans": "个体经营", "zh-Hant": "自營業" } },
  { ja: "パート・アルバイト", label: { ja: "パート・アルバイト", en: "Part-time worker", ko: "아르바이트·파트타임", "zh-Hans": "兼职・打工", "zh-Hant": "兼職・打工" } },
  { ja: "学生", label: { ja: "学生", en: "Student", ko: "학생", "zh-Hans": "学生", "zh-Hant": "學生" } },
  { ja: "未就学児", label: { ja: "未就学児", en: "Preschool child", ko: "미취학 아동", "zh-Hans": "学龄前儿童", "zh-Hant": "學齡前兒童" } },
  { ja: "主婦・主夫", label: { ja: "主婦・主夫", en: "Homemaker", ko: "주부", "zh-Hans": "家庭主妇／主夫", "zh-Hant": "家庭主婦／主夫" } },
  { ja: "退職者・年金受給者", label: { ja: "退職者・年金受給者", en: "Retired", ko: "은퇴자", "zh-Hans": "退休人员", "zh-Hant": "退休人員" } },
  { ja: "無職", label: { ja: "無職", en: "Unemployed", ko: "무직", "zh-Hans": "无业", "zh-Hant": "無業" } },
];

/** 選択肢のどれかの値か（そうでない入力済みの値は「その他」として表示する） */
export function isOccupationChoice(value: string): boolean {
  return OCCUPATIONS.some((o) => o.ja === value);
}
