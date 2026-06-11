// tests/parser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHar } from '../src/parser.js';

const FIXTURE_HAR = {
  log: {
    entries: [
      {
        request: { method: 'GET', url: 'https://api.example.com/users/123' },
        response: { status: 200 },
        time: 245.3,
        timings: { wait: 220.1, receive: 25.2 }
      },
      {
        request: { method: 'POST', url: 'https://api.example.com/orders' },
        response: { status: 201 },
        time: 890.0,
        timings: { wait: 850.0, receive: 40.0 }
      },
    ]
  }
};

test('parseHar extracts method, url, status, and time from each entry', () => {
  const entries = parseHar(FIXTURE_HAR);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    method: 'GET',
    url: 'https://api.example.com/users/123',
    status: 200,
    time: 245.3
  });
});

test('parseHar skips entries with missing timing data', () => {
  const har = {
    log: {
      entries: [
        { request: { method: 'GET', url: 'https://example.com' }, response: { status: 200 } }
      ]
    }
  };
  const entries = parseHar(har);
  assert.equal(entries.length, 0);
});

test('parseHarFile is exported as a function', async () => {
  const { parseHarFile } = await import('../src/parser.js');
  assert.equal(typeof parseHarFile, 'function');
});
