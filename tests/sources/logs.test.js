// tests/sources/logs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/logs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NGINX_FIXTURE = join(__dirname, '..', 'fixtures', 'nginx-sample.log');

test('ingest logs returns GroupStats array from nginx fixture', async () => {
  const groups = await ingest({ input: NGINX_FIXTURE });
  assert.ok(Array.isArray(groups) && groups.length > 0, 'should return non-empty array');
});

test('ingest logs collapses /api/users/1 and /api/users/3 into same template', async () => {
  const groups = await ingest({ input: NGINX_FIXTURE });
  const userGroup = groups.find(g => g.template.includes('{id}') && g.method === 'GET');
  assert.ok(userGroup, 'collapsed user group should exist');
  assert.ok(userGroup.count >= 2, 'should have multiple observations');
});

test('ingest logs GroupStats has p95 > 0', async () => {
  const groups = await ingest({ input: NGINX_FIXTURE });
  assert.ok(groups.every(g => g.p95 > 0), 'all groups must have positive p95');
});

test('ingest logs throws when --input missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});

test('ingest logs auto-detects NDJSON format', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');
  const tmp = j(tmpdir(), 'test-ndjson.log');
  writeFileSync(tmp, [
    JSON.stringify({ method: 'GET', path: '/api/items/1', status: 200, duration_ms: 120 }),
    JSON.stringify({ method: 'GET', path: '/api/items/2', status: 200, duration_ms: 95 }),
    JSON.stringify({ method: 'POST', path: '/api/orders', status: 201, duration_ms: 450 }),
  ].join('\n'));
  try {
    const groups = await ingest({ input: tmp });
    assert.ok(groups.length > 0, 'NDJSON should produce groups');
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
});
