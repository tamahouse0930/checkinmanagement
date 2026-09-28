import { usePublicInfo } from "./usePublicInfo";

/** ホームページ（Google の OAuth 同意画面に登録する公開ページ） */
export function HomePage() {
  const info = usePublicInfo();
  const name = info?.name ?? "TAMAHOUSE";
  return (
    <main className="doc">
      <h1>{name}</h1>
      <p>
        {name} にご宿泊のお客様の事前登録（宿泊者名簿の入力）と、チェックイン・チェックアウトの受け付けを行うシステムです。
        ご宿泊のお客様には、予約サイトのメッセージで登録用の URL をお送りします。
      </p>
      <p lang="en">
        This is the online pre-registration and check-in / check-out system for guests staying at {name}. We will send
        your registration link through the booking site&apos;s messages.
      </p>
      <p>
        <a href="/privacy">個人情報の取り扱い / Privacy Policy</a>
      </p>
      {info?.operatorName && (
        <p className="note">
          運営: {info.operatorName}
          {info.operatorContact && `（${info.operatorContact}）`}
        </p>
      )}
    </main>
  );
}
