import type { Lang } from "./langs";

/**
 * 個人情報の取り扱い（プライバシーポリシー。要件定義書 付録 A）の既定の文面。管理画面の「文面」で言語ごとに書き換えられる。
 * 書き方: 「# 」で始まる行は大見出し、「## 」は見出し、「- 」は箇条書き、空行で段落を区切る。
 * 差し込み: {name} 施設名、{operator} 事業者名（未設定なら施設名）、{contact} 問い合わせ先（未設定なら予約サイトのメッセージ）
 */
export const DEFAULT_PRIVACY: Partial<Record<Lang, string>> = {
  ja: `# 個人情報の取り扱いについて

{operator}（以下「当施設」）は、{name} のご宿泊にあたり、次のとおりお客様の個人情報を取り扱います。

## 1. 取得する情報

氏名、生年月日、住所、職業、連絡先、国籍、パスポート番号、身分証明書（パスポートを含む）の写真、チェックイン時に施設内のタブレットで撮影する顔写真、チェックイン・チェックアウトの日時。

## 2. 利用目的

- 旅館業法に基づく宿泊者名簿の作成・保存
- ご本人の確認（事前に登録された写真と、チェックイン時の写真の照合）
- ご宿泊に関する連絡、緊急時の対応
- 法令に基づき、行政機関・警察などから求めがあった場合の対応

## 3. 保存期間

旅館業法に基づき、チェックアウト日から 3 年間保存し、その後削除します。ご宿泊にならなかった場合（キャンセルや、チェックインされなかった場合）は、保存の必要がないため、その時点で削除します。

## 4. 第三者への提供

法令に基づく場合を除き、ご本人の同意なく第三者に提供しません。

## 5. 安全管理

情報は暗号化された通信で送信され、アクセスが制限された環境（クラウドサービス）に保存します。閲覧できるのは当施設の管理者だけです。

## 6. 外国にある事業者のサービスの利用

お客様の情報は、次の米国の事業者が提供するクラウドサービスに保存します。データは、米国を含む各国のサーバーで保存・処理される場合があります。

- Cloudflare, Inc.（米国）: 宿泊者名簿の情報の保存、このシステムの運用
- Google LLC（米国）: 写真の保存、写真からのパスポート番号の読み取り、当施設の管理者へのお知らせのメール

米国には、日本の個人情報保護法に相当する連邦の包括的な法律はなく、州の法律や分野ごとの法律によって個人情報が保護されています（個人情報保護委員会「外国における個人情報の保護に関する制度等の調査」）。当施設は、閲覧できる管理者を限定し、閲覧や出力の記録を残すなどの安全管理を行っています。

## 7. 同行者の情報

代表者が同行者の情報を入力する場合は、同行者ご本人から、この内容に同意を得たうえで入力してください。同行者ご本人が入力した情報（写真を含む）は、確認のため代表者も閲覧できます。

## 8. お問い合わせ

個人情報の開示・訂正・削除のご依頼は、ご予約いただいた予約サイトのメッセージ、または {contact} までご連絡ください。ただし、法令で保存が義務づけられている期間中は、削除できない場合があります。`,
  en: `# Privacy Policy

{operator} ("we") handles the personal information of guests staying at {name} as follows.

## 1. Information we collect

Name, date of birth, address, occupation, contact information, nationality, passport number, a photo of your ID (including your passport), a face photo taken with the tablet at the property at check-in, and check-in / check-out times.

## 2. Purposes of use

- Creating and keeping the guest register required by the Japanese Hotel Business Act
- Verifying your identity (comparing your registered photo with the photo taken at check-in)
- Contacting you about your stay and responding to emergencies
- Responding to requests from government agencies or the police as required by law

## 3. Retention period

As required by the Hotel Business Act, we keep the information for 3 years after check-out and then delete it. If you do not stay with us (the booking is cancelled or you do not check in), we delete it at that point, as there is no need to keep it.

## 4. Disclosure to third parties

We do not provide your information to third parties without your consent, except as required by law.

## 5. Security

Your information is sent over encrypted connections and stored in an access-restricted cloud environment. Only our administrators can view it.

## 6. Use of services provided by companies outside Japan

Your information is stored in cloud services provided by the following companies in the United States. The data may be stored and processed on servers in various countries, including the United States.

- Cloudflare, Inc. (United States): storing the guest register and running this system
- Google LLC (United States): storing photos, reading the passport number from the photo, and sending notification emails to our administrators

The United States has no comprehensive federal law equivalent to Japan's Act on the Protection of Personal Information; personal information is protected by state laws and sector-specific laws. We limit access to our administrators and keep records of who viewed or exported the information.

## 7. Information about companions

If the main guest enters information on behalf of companions, please obtain their consent to this policy first. Information entered by a companion (including photos) can also be viewed by the main guest for confirmation.

## 8. Contact

To request disclosure, correction or deletion of your information, please contact us through the booking site's messages or at {contact}. Please note that we may not be able to delete information during the retention period required by law.`,
};

/** 問い合わせ先が未設定のときの言い方（言語ごと） */
export const PRIVACY_CONTACT_FALLBACK: Record<Lang, string> = {
  ja: "予約サイトのメッセージ",
  en: "the booking site's messages",
  ko: "예약 사이트의 메시지",
  "zh-Hans": "预订网站的消息",
  "zh-Hant": "訂房網站的訊息",
};

export type PolicyBlock = { type: "h1" | "h2" | "p"; text: string } | { type: "ul"; items: string[] };

/** 文面を、大見出し・見出し・段落・箇条書きに分ける */
export function parsePolicy(text: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: "p", text: paragraph.join("\n") });
    if (list.length > 0) blocks.push({ type: "ul", items: list });
    paragraph = [];
    list = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ type: "h2", text: line.slice(3).trim() });
    } else if (line.startsWith("# ")) {
      flush();
      blocks.push({ type: "h1", text: line.slice(2).trim() });
    } else if (/^[-・]\s?/.test(line)) {
      if (paragraph.length > 0) flush();
      list.push(line.replace(/^[-・]\s?/, "").trim());
    } else {
      if (list.length > 0) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
