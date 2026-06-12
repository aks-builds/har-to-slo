// tests/sources/k6.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/k6.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'k6-summary.json');

test('ingest k6 summary returns one group per collapsed template', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/users/{id}' && g.method === 'GET');
  assert.ok(userGroup, 'GET /users/{id} group should exist after collapsing /users/1 and /users/2');
  assert.equal(userGroup.count, 298, 'count should be sum of both user entries (150+148)');
});

test('ingest k6 summary p95 is count-weighted average across collapsed URLs', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/users/{id}' && g.method === 'GET');
  const expectedP95 = Math.round((310.7 * 150 + 318.4 * 148) / 298);
  assert.equal(userGroup.p95, expectedP95);
});

test('ingest k6 summary POST /orders group has correct p95', async () => {
  const groups = await ingest({ input: FIXTURE });
  const ordersGroup = groups.find(g => g.template === '/orders' && g.method === 'POST');
  assert.ok(ordersGroup, 'POST /orders should be present');
  assert.equal(ordersGroup.p95, 781, 'p95=780.5 rounds to 781');
  assert.equal(ordersGroup.count, 75);
});

test('ingest k6 summary ignores non-trend metrics (counters etc)', async () => {
  const groups = await ingest({ input: FIXTURE });
  const noCounter = groups.every(g => !g.key.includes('http_reqs'));
  assert.ok(noCounter, 'counter metrics should be filtered out');
});

test('ingest k6 throws when --input missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});

test('ingest k6 throws on invalid JSON', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');
  const tmp = j(tmpdir(), 'test-bad-k6.json');
  writeFileSync(tmp, 'not json');
  try {
    await assert.rejects(() => ingest({ input: tmp }), /Invalid k6/);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
});
