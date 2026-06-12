// tests/sources/prometheus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ingest } from '../../src/sources/prometheus.js';

function makeHistogramResponse(labelValues) {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: labelValues.map(({ route, value }) => ({
        metric: { http_route: route },
        value: [Date.now() / 1000, String(value)],
      })),
    },
  };
}

async function startMockProm(onRequest) {
  return new Promise((resolve) => {
    const s = createServer(onRequest);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('ingest prometheus returns GroupStats from histogram_quantile', async () => {
  const srv = await startMockProm((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const query = url.searchParams.get('query') ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (url.pathname === '/api/v1/labels') {
      return res.end(JSON.stringify({ status: 'success', data: ['http_route', '__name__'] }));
    }
    if (query.includes('0.95')) {
      return res.end(JSON.stringify(makeHistogramResponse([
        { route: '/api/users/{id}', value: 0.245 },
        { route: '/api/orders',     value: 0.780 },
      ])));
    }
    res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }));
  });

  const { port } = srv.address();
  try {
    const groups = await ingest({
      url: `http://127.0.0.1:${port}`,
      query: 'http_request_duration_seconds',
      range: '7d',
      step: '1h',
    });
    assert.ok(Array.isArray(groups) && groups.length > 0, 'should return non-empty array');
    const ordersGroup = groups.find(g => g.template === '/api/orders');
    assert.ok(ordersGroup, '/api/orders group must exist');
    assert.ok(ordersGroup.p95 >= 775 && ordersGroup.p95 <= 785,
      `p95=${ordersGroup.p95} should be ~780ms`);
  } finally {
    srv.close();
  }
});

test('ingest prometheus converts seconds to milliseconds', async () => {
  const srv = await startMockProm((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const query = url.searchParams.get('query') ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (url.pathname === '/api/v1/labels')
      return res.end(JSON.stringify({ status: 'success', data: ['http_route'] }));
    if (query.includes('0.95'))
      return res.end(JSON.stringify(makeHistogramResponse([{ route: '/ping', value: 0.050 }])));
    res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }));
  });

  const { port } = srv.address();
  try {
    const groups = await ingest({
      url: `http://127.0.0.1:${port}`,
      query: 'http_request_duration_seconds',
      range: '1d', step: '1h',
    });
    const ping = groups.find(g => g.template === '/ping');
    assert.ok(ping, '/ping group must exist');
    assert.ok(ping.p95 >= 48 && ping.p95 <= 52,
      `p95=${ping.p95} should be ~50ms (0.050s * 1000)`);
  } finally {
    srv.close();
  }
});

test('ingest prometheus throws when --url missing', async () => {
  await assert.rejects(() => ingest({ query: 'my_metric' }), /--url/);
});

test('ingest prometheus throws when --query missing', async () => {
  await assert.rejects(() => ingest({ url: 'http://localhost:9090' }), /--query/);
});

test('ingest prometheus excludes routes where Prometheus returns NaN or +Inf', async () => {
  const srv = await startMockProm((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const query = url.searchParams.get('query') ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (url.pathname === '/api/v1/labels')
      return res.end(JSON.stringify({ status: 'success', data: ['http_route'] }));
    if (query.includes('0.95')) {
      return res.end(JSON.stringify({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [
            { metric: { http_route: '/good' },    value: [1, '0.200'] },   // 200ms — valid
            { metric: { http_route: '/nan-route'}, value: [1, 'NaN'] },    // NaN — exclude
            { metric: { http_route: '/inf-route'}, value: [1, '+Inf'] },   // +Inf — exclude
          ],
        },
      }));
    }
    res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }));
  });

  const { port } = srv.address();
  try {
    const groups = await ingest({
      url: `http://127.0.0.1:${port}`,
      query: 'http_request_duration_seconds',
      range: '7d', step: '1h',
    });
    const templates = groups.map(g => g.template);
    assert.ok(templates.includes('/good'), '/good route must be included');
    assert.ok(!templates.includes('/nan-route'), '/nan-route must be excluded');
    assert.ok(!templates.includes('/inf-route'), '/inf-route must be excluded');
    const good = groups.find(g => g.template === '/good');
    assert.ok(good.p95 >= 195 && good.p95 <= 205, `p95=${good.p95} should be ~200ms`);
  } finally {
    srv.close();
  }
});
