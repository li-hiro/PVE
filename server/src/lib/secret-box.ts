import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const toKey = (secret: string): Buffer =>
  createHash('sha256').update(secret, 'utf8').digest();

/**
 * 使用 AES-256-GCM 对集群 API Token 等敏感字段进行静态加密。
 * 输出格式：v1:<iv>:<tag>:<ciphertext>（均为 base64url）。
 */
export function encryptSecret(plainText: string, secret: string): string {
  const key = toKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(':');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new Error('无法解析加密字段');
  }
  const decipher = createDecipheriv('aes-256-gcm', toKey(secret), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export const maskSecret = (value: string): string =>
  value.length <= 4 ? '******' : `${value.slice(0, 2)}******${value.slice(-2)}`;
