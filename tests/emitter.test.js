// tests/emitter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitThresholds } from '../src/emitter.js';

const SAMPLE_GROUPS = {
  'GET /users/{id}': { count: 100, p50: 120, p75: 180, p95: 300, p99: 450, min: 50, max: 500 },
  'POST /orders':    { count: 20,  p50: 400, p75: 600, p95: 900, p99: 1100, min: 200, max: 1200 },
};

test('emitThresholds returns a string containing thresholds block', () => {
  const output = emitThresholds(SAMPLE_GROUPS, 1.5);
  assert.ok(output.includes('thresholds'), 'should include thresholds key');
  assert.ok(output.includes('p(95)'), 'should use p(95) condition');
  assert.ok(output.includes('options'), 'should include options export');
});

test('emitThresholds applies multiplier to p95 value', () => {
  const output = emitThresholds({ 'GET /ping': { count: 10, p95: 200, p50: 100, p75: 150, p99: 250, min: 80, max: 300 } }, 2.0);
  assert.ok(output.includes('400'), `expected 400ms threshold, got:\n${output}`);
});

test('emitThresholds includes sample count in comment', () => {
  const output = emitThresholds(SAMPLE_GROUPS, 1.5);
  assert.ok(output.includes('100') || output.includes('n=100'), 'should include sample count');
});

test('emitThresholds output contains options and thresholds keys', () => {
  const output = emitThresholds(SAMPLE_GROUPS, 1.5);
  assert.ok(output.includes('options'));
  assert.ok(output.includes('thresholds'));
});
