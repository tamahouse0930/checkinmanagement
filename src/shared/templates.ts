import type { Lang } from "./langs";

/** 管理者がコピーする案内文と、画面に出す文面（要件定義書 L-07、設計書 property_texts） */
export type TextKind = "invite" | "code" | "reject" | "host_contact" | "house_rules";
export const TEXT_KINDS: TextKind[] = ["invite", "code", "reject", "host_contact", "house_rules"];

export const TEXT_KIND_LABEL: Record<TextKind, string> = {
  invite: "URL の案内文",
  code: "暗証番号の案内文",
  reject: "差し戻しの案内文",
  host_contact: "連絡方法（タブレットに表示）",
  house_rules: "ハウスルール（同意してもらう）",
};

export const TEXT_PLACEHOLDERS: Record<TextKind, string> = {
  invite: "{name} 施設名、{url} 入力画面の URL、{checkin_date} チェックイン日、{checkout_date} チェックアウト日",
  code: "{name} 施設名、{code} 暗証番号、{checkin_date} チェックイン日、{checkin_time} チェックイン時刻",
  reject: "{name} 施設名、{reason} 差し戻しの理由、{url} 入力画面の URL",
  host_contact: "",
  house_rules: "",
};

type Defaults = Record<"invite" | "code" | "reject", Record<Lang, string>>;

export const DEFAULT_TEXTS: Defaults = {
  invite: {
    ja: [
      "{name}をご予約いただきありがとうございます。",
      "チェックイン前に、次の URL から宿泊者全員の情報のご登録をお願いします（パスポートまたは顔写真付きの身分証の撮影が必要です）。",
      "{url}",
      "",
      "チェックイン日: {checkin_date}",
      "当日は玄関のタブレットで、宿泊者全員の顔写真を撮影してチェックインします。事前に登録されていない方はご宿泊いただけません。",
    ].join("\n"),
    en: [
      "Thank you for booking {name}.",
      "Before check-in, please register all guests using the link below (you will need to take a photo of each guest's passport or photo ID).",
      "{url}",
      "",
      "Check-in date: {checkin_date}",
      "On arrival, each guest checks in by taking a face photo on the tablet at the entrance. Guests who have not registered in advance cannot stay.",
    ].join("\n"),
    ko: [
      "{name}을(를) 예약해 주셔서 감사합니다.",
      "체크인 전에 아래 URL에서 숙박하시는 모든 분의 정보를 등록해 주세요(여권 또는 사진이 있는 신분증 촬영이 필요합니다).",
      "{url}",
      "",
      "체크인 날짜: {checkin_date}",
      "당일에는 현관의 태블릿으로 모든 숙박객의 얼굴 사진을 촬영하여 체크인합니다. 사전 등록하지 않은 분은 숙박하실 수 없습니다.",
    ].join("\n"),
    "zh-Hans": [
      "感谢您预订{name}。",
      "入住前，请通过以下链接登记所有入住人员的信息（需要拍摄护照或带照片的身份证件）。",
      "{url}",
      "",
      "入住日期：{checkin_date}",
      "入住当天，请在玄关的平板电脑上为每位入住人员拍摄面部照片办理入住。未事先登记的人员无法入住。",
    ].join("\n"),
    "zh-Hant": [
      "感謝您預訂{name}。",
      "入住前，請透過以下連結登記所有入住人員的資料（需要拍攝護照或附照片的身分證件）。",
      "{url}",
      "",
      "入住日期：{checkin_date}",
      "入住當天，請在玄關的平板電腦上為每位入住人員拍攝臉部照片辦理入住。未事先登記的人員無法入住。",
    ].join("\n"),
  },
  code: {
    ja: [
      "ご登録ありがとうございます。確認が完了しました。",
      "キーボックスの暗証番号は【{code}】です。",
      "チェックインは {checkin_date} の {checkin_time} からです。",
      "入室後、玄関のタブレットで宿泊者全員の顔写真を撮影してチェックインしてください。",
    ].join("\n"),
    en: [
      "Thank you for registering. Your registration has been confirmed.",
      "The key box code is [{code}].",
      "Check-in is from {checkin_time} on {checkin_date}.",
      "After entering, please check in by taking a face photo of each guest on the tablet at the entrance.",
    ].join("\n"),
    ko: [
      "등록해 주셔서 감사합니다. 확인이 완료되었습니다.",
      "키 박스 비밀번호는 [{code}]입니다.",
      "체크인은 {checkin_date} {checkin_time}부터입니다.",
      "입실 후 현관의 태블릿으로 모든 숙박객의 얼굴 사진을 촬영하여 체크인해 주세요.",
    ].join("\n"),
    "zh-Hans": [
      "感谢您的登记，确认已完成。",
      "钥匙盒密码是【{code}】。",
      "入住时间为 {checkin_date} {checkin_time} 以后。",
      "进入房间后，请在玄关的平板电脑上为每位入住人员拍摄面部照片办理入住。",
    ].join("\n"),
    "zh-Hant": [
      "感謝您的登記，確認已完成。",
      "鑰匙盒密碼是【{code}】。",
      "入住時間為 {checkin_date} {checkin_time} 以後。",
      "進入房間後，請在玄關的平板電腦上為每位入住人員拍攝臉部照片辦理入住。",
    ].join("\n"),
  },
  reject: {
    ja: ["ご登録ありがとうございます。恐れ入りますが、次の点をご確認のうえ、修正をお願いします。", "{reason}", "", "{url}"].join("\n"),
    en: ["Thank you for registering. Could you please check the following and update your registration?", "{reason}", "", "{url}"].join("\n"),
    ko: ["등록해 주셔서 감사합니다. 번거로우시겠지만 아래 사항을 확인하시고 수정해 주세요.", "{reason}", "", "{url}"].join("\n"),
    "zh-Hans": ["感谢您的登记。请确认以下内容并进行修改。", "{reason}", "", "{url}"].join("\n"),
    "zh-Hant": ["感謝您的登記。請確認以下內容並進行修改。", "{reason}", "", "{url}"].join("\n"),
  },
};

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);
}
