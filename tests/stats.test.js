// tests/stats.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGroups, percentile } from '../src/stats.js';
import { collapseUrl } from '../src/routes.js';

test('percentile returns correct value from sorted array', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 100);
  assert.equal(percentile(sorted, 75), 80);
});

test('computeGroups groups entries by method+template and computes stats', () => {
  const entries = [
    { method: 'GET', url: 'https://api.example.com/users/1', status: 200, time: 100 },
    { method: 'GET', url: 'https://api.example.com/users/2', status: 200, time: 200 },
    { method: 'GET', url: 'https://api.example.com/users/3', status: 200, time: 150 },
    { method: 'POST', url: 'https://api.example.com/orders', status: 201, time: 500 },
  ];

  const groups = computeGroups(entries, collapseUrl);

  assert.ok(groups['GET /users/{id}']);
  assert.equal(groups['GET /users/{id}'].count, 3);
  assert.ok(groups['GET /users/{id}'].p95 > 0);
  assert.ok(groups['POST /orders']);
  assert.equal(groups['POST /orders'].count, 1);
});

test('computeGroups trims outliers before computing percentiles', () => {
  const entries = Array.from({ length: 19 }, (_, i) => ({
    method: 'GET', url: 'https://api.example.com/items/1', status: 200, time: 100 + i
  }));
  entries.push({ method: 'GET', url: 'https://api.example.com/items/1', status: 200, time: 99999 });

  const groups = computeGroups(entries, collapseUrl);
  assert.ok(groups['GET /items/{id}'].p95 < 1000, `p95=${groups['GET /items/{id}'].p95} should be <1000`);
});
