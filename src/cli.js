#!/usr/bin/env node
// src/cli.js
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { emitThresholds } from './emitter.js';

const { values: argv } = parseArgs({
  options: {
    source:       { type: 'string',  short: 's', default: 'har' },
    input:        { type: 'string',  short: 'i' },
    multiplier:   { type: 'string',  short: 'm', default: '1.5' },
    format:       { type: 'string',  short: 'f', default: 'js' },
    output:       { type: 'string',  short: 'o' },
    explain:      { type: 'boolean', short: 'e', default: false },
    // prometheus flags
    url:          { type: 'string' },
    query:        { type: 'string',  short: 'Q' },
    range:        { type: 'string',  default: '7d' },
    step:         { type: 'string',  default: '1h' },
    'prom-header':{ type: 'string' },
    help:         { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
  strict: false,
});

if (argv.help) {
  process.stdout.write(`
har-to-slo — derive k6 SLO baselines from any latency data source

Usage:
  har-to-slo --input recording.har                          (HAR, default)
  har-to-slo --source k6 --input summary.json               (k6 output)
  har-to-slo --source logs --input nginx-access.log         (access logs)
  har-to-slo --source otel --input traces.jsonl             (OpenTelemetry)
  har-to-slo --source prometheus --url http://prom:9090 \\
             --query http_request_duration_seconds           (Prometheus/Mimir)

Sources:   har (default) | k6 | logs | otel | prometheus

Options:
  --source,     -s  Data source (default: har)
  --input,      -i  Input file path (har, k6, otel, logs)
  --multiplier, -m  Threshold = p95 × multiplier (default: 1.5)
  --format,     -f  Output: js or json (default: js)
  --output,     -o  Write to file instead of stdout
  --explain,    -e  Annotate with Claude Haiku (needs ANTHROPIC_API_KEY)
  --url             Prometheus endpoint URL
  --query,      -Q  PromQL metric name
  --range           Prometheus lookback window (default: 7d)
  --step            Prometheus resolution (default: 1h)
  --prom-header     Extra HTTP header for Prometheus (e.g. Authorization)
`);
  process.exit(0);
}

const SOURCES = {
  har:        () => import('./sources/har.js'),
  k6:         () => import('./sources/k6.js'),
  logs:       () => import('./sources/logs.js'),
  otel:       () => import('./sources/otel.js'),
  prometheus: () => import('./sources/prometheus.js'),
};

const source = argv.source;
if (!SOURCES[source]) {
  process.stderr.write(
    `Error: unknown --source "${source}". Use: ${Object.keys(SOURCES).join(', ')}\n`
  );
  process.exit(1);
}

const multiplier = parseFloat(argv.multiplier);
if (isNaN(multiplier) || multiplier <= 0) {
  process.stderr.write('Error: --multiplier must be a positive number\n');
  process.exit(1);
}

try {
  const { ingest } = await SOURCES[source]();
  const groups = await ingest(argv);

  let result;
  if (argv.format === 'json') {
    const thresholds = {};
    for (const g of groups) {
      thresholds[g.key] = {
        p95_baseline: g.p95,
        threshold_ms: Math.round(g.p95 * multiplier),
        count: g.count,
      };
    }
    result = JSON.stringify({ thresholds }, null, 2);
  } else {
    const groupsMap = Object.fromEntries(groups.map(g => [g.key, g]));
    result = emitThresholds(groupsMap, multiplier);
  }

  if (argv.explain && process.env.ANTHROPIC_API_KEY) {
    const { annotate } = await import('./explain.js');
    const groupsMap = Object.fromEntries(groups.map(g => [g.key, g]));
    result = await annotate(result, groupsMap);
  }

  if (argv.output) {
    writeFileSync(argv.output, result, 'utf8');
    process.stderr.write(`Written to ${argv.output}\n`);
  } else {
    process.stdout.write(result);
  }
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
