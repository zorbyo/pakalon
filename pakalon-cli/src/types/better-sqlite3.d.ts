declare module "better-sqlite3" {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement {
    bind(...params: unknown[]): Statement;
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export default class Database {
    constructor(filename: string, options?: Record<string, unknown>);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
  }
}
