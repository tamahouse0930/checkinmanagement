import { useEffect } from "react";

/** ブラウザのタブの名前を施設名にする（読み込み前は index.html の名前のまま） */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
