// src/sources/k6.js
import { readFile } from 'node:fs/promises';
import { collapseUrl } from '../routes.js';

const TAG_URL_RE    = /\burl:([^,}]+)/;
const TAG_METHOD_RE = /\bmethod:([A-Za-z]+)/;

/**
 * Ingest a k6 --summary-export JSON file and return GroupStats[].
 * @param {{ input: string }} argv
 */
export async function ingest(argv) {
  if (!argv.input) {
    throw new Error('--input <path> is required for --source k6');
  }

  let summary;
  try {
    const raw = await readFile(argv.input, 'utf8');
    summary = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid k6 summary JSON at "${argv.input}": ${err.message}`);
    }
    throw new Error(`Could not read k6 summary at "${argv.input}": ${err.message}`);
  }

  const buckets = {};

  for (const [metricKey, metricVal] of Object.entries(summary.metrics ?? {})) {
    if (metricVal.type !== 'trend') continue;
    if (!metricKey.startsWith('http_req_duration')) continue;

    const urlMatch    = TAG_URL_RE.exec(metricKey);
    const methodMatch = TAG_METHOD_RE.exec(metricKey);
    if (!urlMatch) continue;

    const rawUrl   = urlMatch[1].trim();
    const method   = (methodMatch?.[1] ?? 'GET').toUpperCase();
    const template = collapseUrl(rawUrl);
    const key      = `${method} ${template}`;

    const v     = metricVal.values ?? {};
    const p95   = v['p(95)'] ?? v['p95']  ?? 0;
    const p50   = v['p(50)'] ?? v['med']   ?? v['p50'] ?? 0;
    const p75   = v['p(75)'] ?? v['p75']   ?? 0;
    const p99   = v['p(99)'] ?? v['p99']   ?? 0;
    const count = Math.max(1, v.count ?? 1);
    const min   = v.min ?? 0;
    const max   = v.max ?? 0;

    if (!buckets[key]) {
      buckets[key] = { method, template, p95w: 0, p50w: 0, p75w: 0, p99w: 0,
                       totalCount: 0, minVal: Infinity, maxVal: 0 };
    }
    const b = buckets[key];
    b.p95w       += p95 * count;
    b.p50w       += p50 * count;
    b.p75w       += p75 * count;
    b.p99w       += p99 * count;
    b.totalCount += count;
    b.minVal      = Math.min(b.minVal, min);
    b.maxVal      = Math.max(b.maxVal, max);
  }

  return Object.entries(buckets).map(([key, b]) => ({
    key,
    method:   b.method,
    template: b.template,
    count:    b.totalCount,
    p50:      Math.round(b.p50w / b.totalCount),
    p75:      Math.round(b.p75w / b.totalCount),
    p95:      Math.round(b.p95w / b.totalCount),
    p99:      Math.round(b.p99w / b.totalCount),
    min:      Math.round(b.minVal === Infinity ? 0 : b.minVal),
    max:      Math.round(b.maxVal),
  }));
}
