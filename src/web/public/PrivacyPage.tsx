import { usePublicInfo } from "./usePublicInfo";

/** 個人情報の取り扱い（要件定義書 付録 A）。事業者名と問い合わせ先は管理画面の設定から入る */
export function PrivacyPage() {
  const info = usePublicInfo();
  if (!info) return <main className="doc">読み込み中… / Loading…</main>;
  const operator = info.operatorName || info.name;
  const contact = info.operatorContact || "予約サイトのメッセージ";
  const contactEn = info.operatorContact || "the booking site's messages";

  return (
    <main className="doc">
      <h1>個人情報の取り扱いについて</h1>
      <p>
        {operator}（以下「当施設」）は、{info.name} のご宿泊にあたり、次のとおりお客様の個人情報を取り扱います。
      </p>
      <h2>1. 取得する情報</h2>
      <p>
        氏名、生年月日、住所、職業、連絡先、国籍、パスポート番号、身分証明書（パスポートを含む）の写真、チェックイン時に施設内のタブレットで撮影する顔写真、チェックイン・チェックアウトの日時。
      </p>
      <h2>2. 利用目的</h2>
      <ol>
        <li>旅館業法に基づく宿泊者名簿の作成・保存</li>
        <li>ご本人の確認（事前に登録された写真と、チェックイン時の写真の照合）</li>
        <li>ご宿泊に関する連絡、緊急時の対応</li>
        <li>法令に基づき、行政機関・警察などから求めがあった場合の対応</li>
      </ol>
      <h2>3. 保存期間</h2>
      <p>
        旅館業法に基づき、チェックアウト日から 3 年間保存し、その後削除します。ご宿泊にならなかった場合（キャンセルや、チェックインされなかった場合）は、保存の必要がないため、その時点で削除します。
      </p>
      <h2>4. 第三者への提供</h2>
      <p>法令に基づく場合を除き、ご本人の同意なく第三者に提供しません。</p>
      <h2>5. 安全管理</h2>
      <p>
        情報は暗号化された通信で送信され、アクセスが制限された環境（クラウドサービス）に保存します。閲覧できるのは当施設の管理者だけです。
      </p>
      <h2>6. 外国にある事業者のサービスの利用</h2>
      <p>お客様の情報は、次の米国の事業者が提供するクラウドサービスに保存します。データは、米国を含む各国のサーバーで保存・処理される場合があります。</p>
      <ul>
        <li>Cloudflare, Inc.（米国）: 宿泊者名簿の情報の保存、このシステムの運用</li>
        <li>Google LLC（米国）: 写真の保存、写真からのパスポート番号の読み取り、当施設の管理者へのお知らせのメール</li>
      </ul>
      <p>
        米国には、日本の個人情報保護法に相当する連邦の包括的な法律はなく、州の法律や分野ごとの法律によって個人情報が保護されています（個人情報保護委員会「外国における個人情報の保護に関する制度等の調査」）。当施設は、閲覧できる管理者を限定し、閲覧や出力の記録を残すなどの安全管理を行っています。
      </p>
      <h2>7. 同行者の情報</h2>
      <p>
        代表者が同行者の情報を入力する場合は、同行者ご本人から、この内容に同意を得たうえで入力してください。同行者ご本人が入力した情報（写真を含む）は、確認のため代表者も閲覧できます。
      </p>
      <h2>8. お問い合わせ</h2>
      <p>
        個人情報の開示・訂正・削除のご依頼は、ご予約いただいた予約サイトのメッセージ、または {contact} までご連絡ください。ただし、法令で保存が義務づけられている期間中は、削除できない場合があります。
      </p>

      <hr />

      <section lang="en">
        <h1>Privacy Policy</h1>
        <p>
          {operator} (&quot;we&quot;) handles the personal information of guests staying at {info.name} as follows.
        </p>
        <h2>1. Information we collect</h2>
        <p>
          Name, date of birth, address, occupation, contact information, nationality, passport number, a photo of your ID (including
          your passport), a face photo taken with the tablet at the property at check-in, and check-in / check-out
          times.
        </p>
        <h2>2. Purposes of use</h2>
        <ol>
          <li>Creating and keeping the guest register required by the Japanese Hotel Business Act</li>
          <li>Verifying your identity (comparing your registered photo with the photo taken at check-in)</li>
          <li>Contacting you about your stay and responding to emergencies</li>
          <li>Responding to requests from government agencies or the police as required by law</li>
        </ol>
        <h2>3. Retention period</h2>
        <p>
          As required by the Hotel Business Act, we keep the information for 3 years after check-out and then delete it. If
          you do not stay with us (the booking is cancelled or you do not check in), we delete it at that point, as there is
          no need to keep it.
        </p>
        <h2>4. Disclosure to third parties</h2>
        <p>We do not provide your information to third parties without your consent, except as required by law.</p>
        <h2>5. Security</h2>
        <p>
          Your information is sent over encrypted connections and stored in an access-restricted cloud environment.
          Only our administrators can view it.
        </p>
        <h2>6. Use of services provided by companies outside Japan</h2>
        <p>
          Your information is stored in cloud services provided by the following companies in the United States. The data
          may be stored and processed on servers in various countries, including the United States.
        </p>
        <ul>
          <li>Cloudflare, Inc. (United States): storing the guest register and running this system</li>
          <li>Google LLC (United States): storing photos, reading the passport number from the photo, and sending notification emails to our administrators</li>
        </ul>
        <p>
          The United States has no comprehensive federal law equivalent to Japan&apos;s Act on the Protection of Personal
          Information; personal information is protected by state laws and sector-specific laws. We limit access to our
          administrators and keep records of who viewed or exported the information.
        </p>
        <h2>7. Information about companions</h2>
        <p>
          If the main guest enters information on behalf of companions, please obtain their consent to this policy
          first. Information entered by a companion (including photos) can also be viewed by the main guest for
          confirmation.
        </p>
        <h2>8. Contact</h2>
        <p>
          To request disclosure, correction or deletion of your information, please contact us through the booking
          site&apos;s messages or at {contactEn}. Please note that we may not be able to delete information during the
          retention period required by law.
        </p>
      </section>
      <p>
        <a href="/">{info.name}</a>
      </p>
    </main>
  );
}
