import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, GENESIS_HASH, newId, sha256Hex } from '../../src/lib/digest.js';

test('canonicalJson 对嵌套对象按键排序，保证哈希输入稳定', () => {
  const left = { b: 2, a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, b: 2 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalJson(left), '{"a":{"c":3,"d":4},"b":2}');
});

test('canonicalJson 保留数组顺序并处理特殊值', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  assert.equal(canonicalJson(null), 'null');
  assert.equal(canonicalJson(undefined), 'null');
});

test('sha256Hex 与已知向量一致', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(GENESIS_HASH.length, 64);
});

test('newId 生成互不相同的 UUID', () => {
  const first = newId();
  const second = newId();
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
