// src/sources/prometheus.js
import { get as httpGet }  from 'node:http';
import { get as httpsGet } from 'node:https';
import { URL }             from 'node:url';
import { collapseUrl }     from '../routes.js';

const ROUTE_LABELS = ['http_route', 'route', 'handler', 'path', 'url', 'endpoint'];

async function fetchJson(baseUrl, pathname, params, extraHeaders = {}) {
  const u = new URL(pathname, baseUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const isHttps = u.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: u.hostname,
      port:     u.port || (isHttps ? 443 : 80),
      path:     `${u.pathname}?${u.searchParams}`,
      headers:  { Accept: 'application/json', ...extraHeaders },
    };
    const req = (isHttps ? httpsGet : httpGet)(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Non-JSON response from Prometheus: ${body.slice(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Prometheus request timed out')); });
  });
}

async function queryInstant(baseUrl, query, headers) {
  const resp = await fetchJson(baseUrl, '/api/v1/query', { query }, headers);
  if (resp.status !== 'success') throw new Error(`Prometheus error: ${resp.error ?? resp.status}`);
  return resp.data?.result ?? [];
}

async function discoverRouteLabel(baseUrl, metricName, headers) {
  const resp = await fetchJson(baseUrl, '/api/v1/labels',
    { 'match[]': `{__name__="${metricName}_bucket"}` }, headers);
  const available = new Set(resp.data ?? []);
  return ROUTE_LABELS.find(l => available.has(l)) ?? ROUTE_LABELS[0];
}

export async function ingest(argv) {
  if (!argv.url)   throw new Error('--url <prometheus-endpoint> is required for --source prometheus');
  if (!argv.query) throw new Error('--query <metric-name> is required for --source prometheus');

  const range   = argv.range  ?? '7d';
  const headers = {};
  if (argv['prom-header']) {
    const [hName, ...rest] = argv['prom-header'].split(':');
    headers[hName.trim()] = rest.join(':').trim();
  }

  const routeLabel = await discoverRouteLabel(argv.url, argv.query, headers);

  const percentiles = { p50: 0.50, p75: 0.75, p95: 0.95, p99: 0.99 };
  const pctResults = {};
  for (const [name, q] of Object.entries(percentiles)) {
    const promQuery =
      `histogram_quantile(${q}, sum by (le, ${routeLabel}) ` +
      `(rate(${argv.query}_bucket[${range}])))`;
    pctResults[name] = await queryInstant(argv.url, promQuery, headers);
  }

  const countQuery =
    `sum by (${routeLabel}) (increase(${argv.query}_count[${range}]))`;
  const countResults = await queryInstant(argv.url, countQuery, headers);
  const countMap = Object.fromEntries(
    countResults.map(r => [r.metric[routeLabel] ?? '', Math.round(parseFloat(r.value[1]) || 1)])
  );

  const groups = [];
  for (const item of pctResults.p95) {
    const rawRoute = item.metric[routeLabel] ?? '';
    if (!rawRoute) continue;

    const p95Ms = Math.round(parseFloat(item.value[1]) * 1000);
    if (!Number.isFinite(p95Ms) || p95Ms <= 0) continue;

    const fakeUrl  = rawRoute.startsWith('http') ? rawRoute : `https://host${rawRoute}`;
    const template = collapseUrl(fakeUrl);
    const method   = item.metric.method ?? item.metric.http_method ?? 'GET';
    const key      = `${method.toUpperCase()} ${template}`;
    const count    = countMap[rawRoute] ?? 1;

    const getP = (name) => {
      const r = pctResults[name].find(x => x.metric[routeLabel] === rawRoute);
      if (!r) return 0;
      const ms = Math.round(parseFloat(r.value[1]) * 1000);
      return Number.isFinite(ms) ? ms : 0;
    };

    groups.push({
      key, method: method.toUpperCase(), template, count,
      p50: getP('p50'), p75: getP('p75'), p95: p95Ms, p99: getP('p99'),
      min: 0,
      max: 0,
    });
  }

  return groups;
}
