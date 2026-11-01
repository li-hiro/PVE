import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * 审计哈希链使用的规范化 JSON：递归按键排序，确保同一内容在任意进程都产生相同摘要。
 */
export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortValue(value));
  // JSON.stringify(undefined) 返回 undefined，统一按 null 处理以保证哈希输入始终为字符串。
  return serialized === undefined ? 'null' : serialized;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      sorted[key] = sortValue(item);
    }
    return sorted;
  }
  return value;
}

export const sha256Hex = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

export const GENESIS_HASH = '0'.repeat(64);

export function newId(): string {
  return randomUUID();
}

export function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('base64url')}`;
}
