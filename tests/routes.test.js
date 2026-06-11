// tests/routes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseUrl } from '../src/routes.js';

test('collapses numeric path segments to {id}', () => {
  assert.equal(collapseUrl('https://api.example.com/users/123'), '/users/{id}');
  assert.equal(collapseUrl('https://api.example.com/orders/42/items/7'), '/orders/{id}/items/{id}');
});

test('collapses UUIDs to {uuid}', () => {
  assert.equal(
    collapseUrl('https://api.example.com/users/550e8400-e29b-41d4-a716-446655440000'),
    '/users/{uuid}'
  );
});

test('collapses long hex strings to {hash}', () => {
  assert.equal(
    collapseUrl('https://api.example.com/commits/abc123def456abc1'),
    '/commits/{hash}'
  );
});

test('preserves non-parameterized paths unchanged', () => {
  assert.equal(collapseUrl('https://api.example.com/health'), '/health');
  assert.equal(collapseUrl('https://api.example.com/api/v2/users'), '/api/v2/users');
});

test('strips query string', () => {
  assert.equal(collapseUrl('https://api.example.com/users?page=1&limit=10'), '/users');
});

test('strips hostname, keeps only path', () => {
  assert.equal(collapseUrl('https://my-api.internal:8080/v1/items/99'), '/v1/items/{id}');
});
