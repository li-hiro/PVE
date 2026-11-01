import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/index.js';
import { AuditLedger } from '../../src/modules/audit/audit-ledger.js';

function createLedger(): { ledger: AuditLedger; db: ReturnType<typeof openDatabase> } {
  const db = openDatabase(':memory:');
  migrate(db);
  return { ledger: new AuditLedger(db), db };
}

const appendSample = (ledger: AuditLedger, actor: string, action: string): void => {
  ledger.append({
    actorId: `user-${actor}`,
    actorName: actor,
    action,
    targetType: 'guest',
    targetId: 'cluster-demo:101',
    result: 'success',
    ip: '10.0.0.1',
    userAgent: 'test-agent',
    requestId: 'req-1',
    detail: { cores: 2 },
  });
};

test('审计事件形成连续哈希链且可校验', () => {
  const { ledger } = createLedger();
  appendSample(ledger, 'alice', 'guest.create');
  appendSample(ledger, 'bob', 'guest.power.start');
  appendSample(ledger, 'alice', 'guest.delete');

  const report = ledger.verify();
  assert.equal(report.valid, true);
  assert.equal(report.checked, 3);
  assert.equal(report.headSeq, 3);
});

test('篡改事件内容会被哈希链校验发现', () => {
  const { ledger, db } = createLedger();
  appendSample(ledger, 'alice', 'guest.create');
  appendSample(ledger, 'bob', 'guest.power.start');
  appendSample(ledger, 'alice', 'guest.delete');

  db.prepare("UPDATE audit_events SET detail = '{\"cores\":64}' WHERE seq = 2").run();
  const report = ledger.verify();
  assert.equal(report.valid, false);
  assert.equal(report.brokenAt, 2);
});

test('删除断链会在下一条事件处暴露', () => {
  const { ledger, db } = createLedger();
  appendSample(ledger, 'alice', 'guest.create');
  appendSample(ledger, 'bob', 'guest.power.start');
  appendSample(ledger, 'alice', 'guest.delete');

  db.prepare('DELETE FROM audit_events WHERE seq = 2').run();
  const report = ledger.verify();
  assert.equal(report.valid, false);
  assert.equal(report.brokenAt, 3);
});

test('按区间校验与统计支持审计报表', () => {
  const { ledger } = createLedger();
  appendSample(ledger, 'alice', 'guest.create');
  ledger.append({
    actorId: 'user-bob',
    actorName: 'bob',
    action: 'guest.power.stop',
    targetType: 'guest',
    targetId: 'cluster-demo:101',
    result: 'failure',
  });

  const ranged = ledger.verify(2, 2);
  assert.equal(ranged.valid, true);
  assert.equal(ranged.checked, 1);

  const stats = ledger.stats({});
  assert.equal(stats.total, 2);
  assert.equal(stats.success, 1);
  assert.equal(stats.failure, 1);
  assert.equal(stats.byActor.length, 2);
});
