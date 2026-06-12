// tests/integration.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.js');
const HAR = join(__dirname, 'fixtures', 'sample.har');
const K6_FIXTURE   = join(__dirname, 'fixtures', 'k6-summary.json');
const OTEL_FIXTURE  = join(__dirname, 'fixtures', 'traces.jsonl');
const LOGS_FIXTURE  = join(__dirname, 'fixtures', 'nginx-sample.log');

test('CLI outputs valid k6 thresholds from fixture HAR', () => {
  const output = execSync(`node ${CLI} --input "${HAR}"`).toString();
  assert.ok(output.includes('thresholds'), 'output must contain thresholds');
  assert.ok(output.includes('p(95)'), 'output must contain p(95) condition');
  assert.ok(output.includes('options'), 'output must contain options export');
});

test('CLI --multiplier flag changes threshold value', () => {
  const out1 = execSync(`node ${CLI} --input "${HAR}" --multiplier 1.0`).toString();
  const out2 = execSync(`node ${CLI} --input "${HAR}" --multiplier 3.0`).toString();
  const nums1 = (out1.match(/p\(95\)<(\d+)/g) ?? []).map(m => parseInt(m.match(/p\(95\)<(\d+)/)[1]));
  const nums2 = (out2.match(/p\(95\)<(\d+)/g) ?? []).map(m => parseInt(m.match(/p\(95\)<(\d+)/)[1]));
  assert.ok(nums2.length > 0, 'should have threshold values');
  assert.ok(nums2.every((v, i) => v > (nums1[i] ?? 0)), 'higher multiplier should yield higher thresholds');
});

test('CLI --format json emits JSON not JS', () => {
  const output = execSync(`node ${CLI} --input "${HAR}" --format json`).toString();
  const parsed = JSON.parse(output);
  assert.ok(parsed.thresholds, 'JSON output must have thresholds key');
});

test('CLI exits 1 with error when --input is missing', () => {
  try {
    execSync(`node ${CLI}`, { stdio: 'pipe' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.status, 1, 'exit code should be 1');
  }
});

test('CLI --source k6 outputs thresholds from k6 summary', () => {
  const output = execSync(`node ${CLI} --source k6 --input "${K6_FIXTURE}"`).toString();
  assert.ok(output.includes('thresholds'), 'must include thresholds');
  assert.ok(output.includes('p(95)'), 'must include p(95) condition');
  assert.ok(output.includes('options'), 'must export options');
});

test('CLI --source k6 --format json returns JSON with thresholds key', () => {
  const output = execSync(`node ${CLI} --source k6 --input "${K6_FIXTURE}" --format json`).toString();
  const parsed = JSON.parse(output);
  assert.ok(parsed.thresholds, 'JSON must have thresholds key');
});

test('CLI exits 1 for unknown --source', () => {
  try {
    execSync(`node ${CLI} --source nonexistent --input x.har`, { stdio: 'pipe' });
    assert.fail('should exit 1');
  } catch (e) {
    assert.equal(e.status, 1);
  }
});

test('CLI default (no --source) produces same output as --source har', () => {
  const outDefault  = execSync(`node ${CLI} --input "${HAR}"`).toString();
  const outExplicit = execSync(`node ${CLI} --source har --input "${HAR}"`).toString();
  assert.equal(outDefault, outExplicit, 'omitting --source should be identical to --source har');
});

test('CLI --source otel produces thresholds from OTEL trace fixture', () => {
  const output = execSync(`node ${CLI} --source otel --input "${OTEL_FIXTURE}"`).toString();
  assert.ok(output.includes('thresholds'), 'must include thresholds');
  assert.ok(output.includes('p(95)'), 'must include p(95)');
});

test('CLI --source logs produces thresholds from nginx fixture', () => {
  const output = execSync(`node ${CLI} --source logs --input "${LOGS_FIXTURE}"`).toString();
  assert.ok(output.includes('thresholds'));
  assert.ok(output.includes('p(95)'));
});
