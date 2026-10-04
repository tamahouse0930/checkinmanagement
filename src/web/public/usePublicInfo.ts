import { useEffect, useState } from "react";
import type { Lang } from "../../shared/langs";
import { api } from "../lib/api";
import { useDocumentTitle } from "../lib/title";

export interface PublicInfo {
  name: string;
  operatorName: string;
  operatorContact: string;
  /** 管理者が書き換えたプライバシーポリシー（言語ごと） */
  privacy: Partial<Record<Lang, string>>;
}

export function usePublicInfo(): PublicInfo | null {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => {
    api<PublicInfo>("/api/public/info")
      .then(setInfo)
      .catch(() => setInfo({ name: "", operatorName: "", operatorContact: "", privacy: {} }));
  }, []);
  useDocumentTitle(info?.name);
  return info;
}
