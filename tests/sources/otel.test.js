// tests/sources/otel.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/otel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'traces.jsonl');

test('ingest otel filters out INTERNAL spans', async () => {
  const groups = await ingest({ input: FIXTURE });
  const keys = groups.map(g => g.key);
  assert.ok(!keys.some(k => k.includes('cache-lookup')), 'INTERNAL span must be filtered');
});

test('ingest otel groups 3 SERVER GET /api/users spans into one template', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/api/users/{id}' && g.method === 'GET');
  assert.ok(userGroup, 'GET /api/users/{id} group should exist');
  assert.equal(userGroup.count, 3, 'should have 3 observations');
});

test('ingest otel converts durationNano to ms correctly', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/api/users/{id}');
  // 245.3ms, 182.1ms, 310.5ms → p95 should be ≈ 310ms
  assert.ok(userGroup.p95 >= 280 && userGroup.p95 <= 320,
    `p95=${userGroup.p95} should be ~310ms`);
});

test('ingest otel accepts numeric kind=2 (SERVER)', async () => {
  const groups = await ingest({ input: FIXTURE });
  const healthGroup = groups.find(g => g.template === '/health');
  assert.ok(healthGroup, '/health span with kind=2 should be included');
});

test('ingest otel accepts string kind="SERVER"', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/api/users/{id}');
  assert.equal(userGroup.count, 3);
});

test('ingest otel throws when --input missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});
