import { useEffect, useState } from "react";

/** 画面内の移動（ページを読み込み直さない） */
export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(location.pathname);
  useEffect(() => {
    const onChange = () => setPathname(location.pathname);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return pathname;
}
