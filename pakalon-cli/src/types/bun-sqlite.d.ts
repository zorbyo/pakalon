declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, options?: { create?: boolean });
    run(sql: string, ...params: unknown[]): void;
    query(sql: string): unknown;
    close(): void;
  }
}
