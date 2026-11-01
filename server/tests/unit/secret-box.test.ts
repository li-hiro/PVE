import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, maskSecret } from '../../src/lib/secret-box.js';

const KEY = 'unit-test-encryption-key';

test('AES-256-GCM 加密后可正确解密', () => {
  const secret = 'PVEAPIToken=root@pam!virtgate=12345678-abcd';
  const encrypted = encryptSecret(secret, KEY);
  assert.notEqual(encrypted, secret);
  assert.match(encrypted, /^v1:/);
  assert.equal(decryptSecret(encrypted, KEY), secret);
});

test('相同明文每次加密得到不同密文（随机 IV）', () => {
  const first = encryptSecret('same-secret', KEY);
  const second = encryptSecret('same-secret', KEY);
  assert.notEqual(first, second);
});

test('使用错误密钥或篡改密文均无法解密', () => {
  const encrypted = encryptSecret('secret', KEY);
  assert.throws(() => decryptSecret(encrypted, 'wrong-key'));
  const tampered = `${encrypted.slice(0, -2)}AA`;
  assert.throws(() => decryptSecret(tampered, KEY));
});

test('maskSecret 仅暴露首尾字符', () => {
  assert.equal(maskSecret('abcdef'), 'ab******ef');
  assert.equal(maskSecret('abc'), '******');
});
