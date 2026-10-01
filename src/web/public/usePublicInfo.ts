import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useDocumentTitle } from "../lib/title";

export interface PublicInfo {
  name: string;
  operatorName: string;
  operatorContact: string;
}

export function usePublicInfo(): PublicInfo | null {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => {
    api<PublicInfo>("/api/public/info")
      .then(setInfo)
      .catch(() => setInfo({ name: "", operatorName: "", operatorContact: "" }));
  }, []);
  useDocumentTitle(info?.name);
  return info;
}
