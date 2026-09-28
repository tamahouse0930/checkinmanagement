import { useEffect, useState } from "react";
import { api } from "../lib/api";

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
      .catch(() => setInfo({ name: "TAMAHOUSE", operatorName: "", operatorContact: "" }));
  }, []);
  return info;
}
