/**
 * D1 へのアクセスを 1 か所に集め、1 回のリクエストで読み書きした行数を数える（設計書 11 章）。
 * `first()` は読み取り行数を返さないため、常に `all()` / `run()` / `batch()` を使う。
 */
export class Db {
  rowsRead = 0;
  rowsWritten = 0;
  queries = 0;

  constructor(private readonly d1: D1Database) {}

  prepare(sql: string): D1PreparedStatement {
    return this.d1.prepare(sql);
  }

  async all<T>(stmt: D1PreparedStatement): Promise<T[]> {
    const result = await stmt.all<T>();
    this.track(result.meta);
    return result.results;
  }

  async first<T>(stmt: D1PreparedStatement): Promise<T | null> {
    return (await this.all<T>(stmt))[0] ?? null;
  }

  async run(stmt: D1PreparedStatement): Promise<D1Result> {
    const result = await stmt.run();
    this.track(result.meta);
    return result;
  }

  /** 複数の SQL を 1 回の問い合わせにまとめる（設計書 DB-02） */
  async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results = await this.d1.batch<T>(stmts);
    this.queries -= results.length - 1;
    for (const result of results) this.track(result.meta);
    return results;
  }

  private track(meta: D1Meta): void {
    this.queries += 1;
    this.rowsRead += meta.rows_read ?? 0;
    this.rowsWritten += meta.rows_written ?? 0;
  }
}
