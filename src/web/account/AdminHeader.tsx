import type { AccountMe } from "../../shared/api-types";
import { navigate } from "../lib/router";
import { logout } from "./useAccount";

/**
 * 施設の管理画面とシステム管理の画面の共通のヘッダー（設計書 4.15）。
 * 両方の権限を持つ人には、上の段に画面の切り替えを出す（スマホでもメニューの中に埋もれないようにする）
 */
export function AdminHeader(props: {
  me: AccountMe;
  current: "facility" | "system";
  title: string;
  nav: { path: string; label: string }[];
  isActive: (path: string) => boolean;
}) {
  const { me } = props;
  const both = me.roles.facility && me.roles.system;
  return (
    <header className="admin-header">
      {both && (
        <div className="admin-switch" role="tablist" aria-label="画面の切り替え">
          <a href="/admin" className={props.current === "facility" ? "active" : undefined} aria-selected={props.current === "facility"}>
            施設の管理
          </a>
          <a href="/system" className={props.current === "system" ? "active" : undefined} aria-selected={props.current === "system"}>
            システム管理
          </a>
        </div>
      )}
      <div className="admin-header-main">
        <strong>{props.title}</strong>
        <nav>
          {props.nav.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={props.isActive(item.path) ? "active" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button className="link" onClick={logout} title={me.email}>
          ログアウト
        </button>
      </div>
    </header>
  );
}
