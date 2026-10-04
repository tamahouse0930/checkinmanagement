import { describe, expect, it } from "vitest";
import { DEFAULT_PRIVACY, parsePolicy } from "../src/shared/privacy";
import { renderTemplate } from "../src/shared/templates";

describe("プライバシーポリシーの文面（管理画面で書き換えられる）", () => {
  it("大見出し・見出し・段落・箇条書きに分ける", () => {
    const blocks = parsePolicy("# タイトル\n\n本文の 1 行目\n本文の 2 行目\n\n## 1. 見出し\n- 項目 A\n- 項目 B\n\n最後の段落");
    expect(blocks).toEqual([
      { type: "h1", text: "タイトル" },
      { type: "p", text: "本文の 1 行目\n本文の 2 行目" },
      { type: "h2", text: "1. 見出し" },
      { type: "ul", items: ["項目 A", "項目 B"] },
      { type: "p", text: "最後の段落" },
    ]);
  });

  it("「・」で始まる行も箇条書きにする", () => {
    expect(parsePolicy("・りんご\n・みかん")).toEqual([{ type: "ul", items: ["りんご", "みかん"] }]);
  });

  it("既定の文面は、施設名・事業者名・問い合わせ先を差し込み、生年月日と保存先の国を含む", () => {
    const ja = renderTemplate(DEFAULT_PRIVACY.ja!, { name: "TAMAHOUSE", operator: "山田民泊", contact: "info@example.com" });
    expect(ja).toContain("山田民泊（以下「当施設」）は、TAMAHOUSE のご宿泊にあたり");
    expect(ja).toContain("生年月日");
    expect(ja).toContain("Cloudflare, Inc.（米国）");
    expect(ja).toContain("または info@example.com までご連絡ください");
    expect(parsePolicy(ja).filter((b) => b.type === "h2")).toHaveLength(8);
  });
});
