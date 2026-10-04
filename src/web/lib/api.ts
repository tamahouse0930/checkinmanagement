export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  // ログインが切れていたら（別の端末からログアウトさせた場合など）、読み直してログイン画面を出す。
  // ログイン中かどうかを確かめる /api/account/me は、ログインしていなければ 401 を返すのが正常なので除く
  if (res.status === 401 && path !== "/api/account/me" && (path.startsWith("/api/admin/") || path.startsWith("/api/system/") || path.startsWith("/api/account/"))) {
    location.reload();
  }
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? `エラーが発生しました（${res.status}）`);
  return data as T;
}
