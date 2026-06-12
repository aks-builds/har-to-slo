// src/sources/otel.js
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { collapseUrl } from '../routes.js';
import { computeGroups } from '../stats.js';

const SERVER_KINDS = new Set(['SPAN_KIND_SERVER', 'SERVER', 2, '2']);

/**
 * collapseUrl percent-encodes curly braces in the pathname (via new URL()),
 * so OTel route templates like /api/users/{id} become /api/users/%7Bid%7D.
 * Wrapping with decodeURIComponent restores them to {id} form.
 */
function otelCollapseUrl(url) {
  const collapsed = collapseUrl(url);
  try {
    return decodeURIComponent(collapsed);
  } catch {
    return collapsed;
  }
}

export async function ingest(argv) {
  if (!argv.input) {
    throw new Error('--input <path-to-traces.jsonl> is required for --source otel');
  }

  const entries = [];

  const rl = createInterface({
    input: createReadStream(argv.input, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let span;
    try { span = JSON.parse(trimmed); } catch { continue; }

    if (!SERVER_KINDS.has(span.kind)) continue;

    const attrs   = span.attributes ?? {};
    const method  = (attrs['http.method'] ?? 'GET').toUpperCase();
    const rawPath = attrs['http.route'] ?? attrs['http.target'] ?? '';
    if (!rawPath) continue;

    const durationMs = Math.round((span.durationNano ?? 0) / 1_000_000);
    if (durationMs <= 0) continue;

    const fakeUrl = rawPath.startsWith('http') ? rawPath : `https://host${rawPath}`;
    entries.push({
      method,
      url:    fakeUrl,
      status: attrs['http.status_code'] ?? 200,
      time:   durationMs,
    });
  }

  const groups = computeGroups(entries, otelCollapseUrl);
  return Object.entries(groups).map(([key, stats]) => {
    const spaceIdx = key.indexOf(' ');
    const method   = key.slice(0, spaceIdx);
    const template = key.slice(spaceIdx + 1);
    return { key, method, template, ...stats };
  });
}
