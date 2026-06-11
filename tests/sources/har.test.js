// tests/sources/har.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/har.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'sample.har');

test('ingest returns GroupStats array from HAR fixture', async () => {
  const groups = await ingest({ input: FIXTURE });
  assert.ok(Array.isArray(groups), 'should return an array');
  assert.ok(groups.length > 0, 'should have at least one group');
});

test('ingest GroupStats has required fields', async () => {
  const groups = await ingest({ input: FIXTURE });
  const g = groups[0];
  assert.ok(typeof g.key === 'string', 'key must be string');
  assert.ok(typeof g.method === 'string', 'method must be string');
  assert.ok(typeof g.template === 'string', 'template must be string');
  assert.ok(typeof g.count === 'number', 'count must be number');
  assert.ok(typeof g.p95 === 'number', 'p95 must be number');
  assert.ok(typeof g.p50 === 'number', 'p50 must be number');
});

test('ingest throws when --input is missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});
