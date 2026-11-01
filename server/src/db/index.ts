import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_STATEMENTS } from './schema.js';

export type Db = DatabaseSync;

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  }
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function migrate(db: Db): void {
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement);
  }
}

export function allRows<T>(db: Db, sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function oneRow<T>(db: Db, sql: string, ...params: SqlValue[]): T | null {
  const row = db.prepare(sql).get(...params) as T | undefined;
  return row ?? null;
}

export function runSql(db: Db, sql: string, ...params: SqlValue[]): RunResult {
  const result = db.prepare(sql).run(...params);
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

/**
 * 立即事务：写操作依赖 SQLite 的串行化保证配额检查与预留的原子性。
 */
export function inTransaction<T>(db: Db, fn: () => T, mode: 'IMMEDIATE' | 'DEFERRED' = 'IMMEDIATE'): T {
  db.exec(`BEGIN ${mode}`);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 事务可能已被 SQLite 自动回滚，忽略二次回滚错误
    }
    throw error;
  }
}

export const closeDatabase = (db: Db): void => {
  try {
    db.close();
  } catch {
    // 已关闭时忽略
  }
};
