# har-to-slo Multi-Source Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use `model: "sonnet"` for every subagent.

**Goal:** Add four new `--source` modes to har-to-slo (k6, logs, otel, prometheus) so any Grafana-stack latency data source can produce k6 SLO thresholds.

**Architecture:** Each source is `src/sources/<name>.js` exporting `async function ingest(argv): GroupStats[]`. The existing `stats.js`, `emitter.js`, and `--explain` pipeline consume `GroupStats[]` unchanged. `src/cli.js` gains a `--source` flag that dynamically imports the right source module.

**Tech Stack:** Node.js ≥20 ESM, `node:test` + `node:assert`, `node:readline` (OTEL streaming), `node:http`/`node:https` (Prometheus — no external HTTP client)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/sources/har.js` | Create | Wrap existing parser.js + computeGroups into ingest() |
| `src/sources/k6.js` | Create | Parse k6 --summary-export JSON → GroupStats[] |
| `src/sources/logs.js` | Create | nginx/ALB/NDJSON access log → GroupStats[] |
| `src/sources/otel.js` | Create | OpenTelemetry trace JSONL → GroupStats[] |
| `src/sources/prometheus.js` | Create | Prometheus HTTP API query → GroupStats[] |
| `src/cli.js` | Modify | Add --source flag + dynamic source routing |
| `tests/sources/har.test.js` | Create | ingest() wraps parser correctly |
| `tests/sources/k6.test.js` | Create | Tag extraction, URL collapsing, weighted p95 |
| `tests/sources/logs.test.js` | Create | Format auto-detect, route collapsing |
| `tests/sources/otel.test.js` | Create | SERVER filter, durationNano→ms, streaming |
| `tests/sources/prometheus.test.js` | Create | Mock HTTP server, label discovery, unit conversion |
| `tests/fixtures/k6-summary.json` | Create | k6 summary fixture with url+method tags |
| `tests/fixtures/traces.jsonl` | Create | OTEL spans fixture (SERVER + INTERNAL mixed) |
| `tests/integration.test.js` | Modify | Add --source k6/logs/otel end-to-end tests |

---

## Task 1: Scaffold `src/sources/` + refactor HAR source

**Files:**
- Create: `src/sources/har.js`
- Create: `tests/sources/har.test.js`

- [ ] **Step 1: Create `src/sources/` directory**

```bash
mkdir -p C:\Users\AdityaKumarSingh\har-to-k6-thresholds\src\sources
mkdir -p C:\Users\AdityaKumarSingh\har-to-k6-thresholds\tests\sources
```

- [ ] **Step 2: Write failing test**

```javascript
// tests/sources/har.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/har.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'sample.har');

test('ingest returns GroupStats array from HAR fixture', async () => {
  const groups = await ingest({ input: FIXTURE });
  assert.ok(Array.isArray(groups), 'should return an array');
  assert.ok(groups.length > 0, 'should have at least one group');
});

test('ingest GroupStats has required fields', async () => {
  const groups = await ingest({ input: FIXTURE });
  const g = groups[0];
  assert.ok(typeof g.key === 'string', 'key must be string');
  assert.ok(typeof g.method === 'string', 'method must be string');
  assert.ok(typeof g.template === 'string', 'template must be string');
  assert.ok(typeof g.count === 'number', 'count must be number');
  assert.ok(typeof g.p95 === 'number', 'p95 must be number');
  assert.ok(typeof g.p50 === 'number', 'p50 must be number');
});

test('ingest throws when --input is missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});
```

- [ ] **Step 3: Run — expect failure**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/sources/har.test.js
```
Expected: `Cannot find module '../../src/sources/har.js'`

- [ ] **Step 4: Create `src/sources/har.js`**

```javascript
// src/sources/har.js
import { parseHarFile } from '../parser.js';
import { collapseUrl }   from '../routes.js';
import { computeGroups } from '../stats.js';

/**
 * Ingest a HAR file and return GroupStats[].
 * @param {{ input: string }} argv
 */
export async function ingest(argv) {
  if (!argv.input) {
    throw new Error('--input <path-to-har> is required for --source har');
  }
  const entries = await parseHarFile(argv.input);
  return Object.values(computeGroups(entries, collapseUrl));
}
```

- [ ] **Step 5: Run — expect 3 passing**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/sources/har.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/sources/har.js tests/sources/har.test.js
git commit -m "refactor: extract HAR ingest into src/sources/har.js"
```

---

## Task 2: k6 source + fixture

**Files:**
- Create: `tests/fixtures/k6-summary.json`
- Create: `src/sources/k6.js`
- Create: `tests/sources/k6.test.js`

- [ ] **Step 1: Create `tests/fixtures/k6-summary.json`**

```json
{
  "metrics": {
    "http_req_duration{expected_response:true,method:GET,url:https://api.example.com/users/1}": {
      "type": "trend",
      "contains": "time",
      "values": {
        "avg": 157.3, "min": 45.2, "med": 142.5, "max": 890.1,
        "p(90)": 245.3, "p(95)": 310.7, "p(99)": 456.2, "count": 150
      }
    },
    "http_req_duration{expected_response:true,method:GET,url:https://api.example.com/users/2}": {
      "type": "trend",
      "contains": "time",
      "values": {
        "avg": 163.1, "min": 50.1, "med": 148.3, "max": 820.5,
        "p(90)": 255.1, "p(95)": 318.4, "p(99)": 461.0, "count": 148
      }
    },
    "http_req_duration{expected_response:true,method:POST,url:https://api.example.com/orders}": {
      "type": "trend",
      "contains": "time",
      "values": {
        "avg": 450.2, "min": 200.1, "med": 420.5, "max": 1200.8,
        "p(90)": 680.3, "p(95)": 780.5, "p(99)": 950.2, "count": 75
      }
    },
    "http_reqs": {
      "type": "counter",
      "contains": "default",
      "values": { "count": 373, "rate": 12.4 }
    },
    "http_req_duration{expected_response:true,method:GET,url:https://api.example.com/health}": {
      "type": "trend",
      "contains": "time",
      "values": {
        "avg": 12.5, "min": 8.0, "med": 11.0, "max": 45.0,
        "p(90)": 18.0, "p(95)": 22.0, "p(99)": 40.0, "count": 300
      }
    }
  }
}
```

- [ ] **Step 2: Write failing test**

```javascript
// tests/sources/k6.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/k6.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'k6-summary.json');

test('ingest k6 summary returns one group per collapsed template', async () => {
  const groups = await ingest({ input: FIXTURE });
  const keys = groups.map(g => g.key);
  // /users/1 and /users/2 collapse to the same GET /users/{id} template
  const userGroup = groups.find(g => g.template === '/users/{id}' && g.method === 'GET');
  assert.ok(userGroup, 'GET /users/{id} group should exist after collapsing /users/1 and /users/2');
  assert.equal(userGroup.count, 298, 'count should be sum of both user entries (150+148)');
});

test('ingest k6 summary p95 is count-weighted average across collapsed URLs', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/users/{id}' && g.method === 'GET');
  // Weighted: (310.7*150 + 318.4*148) / 298 ≈ 314.5 → rounded
  const expectedP95 = Math.round((310.7 * 150 + 318.4 * 148) / 298);
  assert.equal(userGroup.p95, expectedP95);
});

test('ingest k6 summary POST /orders group has correct p95', async () => {
  const groups = await ingest({ input: FIXTURE });
  const ordersGroup = groups.find(g => g.template === '/orders' && g.method === 'POST');
  assert.ok(ordersGroup, 'POST /orders should be present');
  assert.equal(ordersGroup.p95, 781, 'p95=780.5 rounds to 781');
  assert.equal(ordersGroup.count, 75);
});

test('ingest k6 summary ignores non-trend metrics (counters etc)', async () => {
  const groups = await ingest({ input: FIXTURE });
  // http_reqs is a counter, should not appear
  const noCounter = groups.every(g => g.key !== 'http_reqs');
  assert.ok(noCounter, 'counter metrics should be filtered out');
});

test('ingest k6 throws when --input missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});

test('ingest k6 throws on invalid JSON', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const tmp = join(import.meta.dirname ?? '.', 'bad.json');
  writeFileSync(tmp, 'not json');
  try {
    await assert.rejects(() => ingest({ input: tmp }), /Invalid k6/);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
});
```

- [ ] **Step 3: Run — expect failure**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/sources/k6.test.js
```
Expected: `Cannot find module '../../src/sources/k6.js'`

- [ ] **Step 4: Create `src/sources/k6.js`**

```javascript
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

  // Accumulate weighted stats per collapsed template key
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
```

- [ ] **Step 5: Run — expect 6 passing**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/sources/k6.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/sources/k6.js tests/sources/k6.test.js tests/fixtures/k6-summary.json
git commit -m "feat(source): add --source k6 for k6 summary-export JSON"
```

---

## Task 3: CLI `--source` flag routing

**Files:**
- Modify: `src/cli.js`
- Modify: `tests/integration.test.js`

- [ ] **Step 1: Read current `src/cli.js` to understand existing structure**

Open `src/cli.js` and note: `parseArgs` options block, the `parseHarFile → computeGroups → emitThresholds` pipeline, and the `argv.explain` dynamic import.

- [ ] **Step 2: Write failing integration test for `--source k6`**

Add to `tests/integration.test.js`:
```javascript
// Add after existing tests in tests/integration.test.js
import { join as joinPath, dirname as dirName } from 'node:path';
import { fileURLToPath as fileToUrl } from 'node:url';

const __dir = dirName(fileToUrl(import.meta.url));
const K6_FIXTURE = joinPath(__dir, 'fixtures', 'k6-summary.json');

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

test('CLI default (no --source) still works as HAR', () => {
  const output = execSync(`node ${CLI} --input "${HAR}"`).toString();
  assert.ok(output.includes('thresholds'));
});
```

- [ ] **Step 3: Run — expect failures**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/integration.test.js
```
Expected: the 4 new tests fail with unknown flag or missing --source support.

- [ ] **Step 4: Update `src/cli.js`**

Replace the existing file with:

```javascript
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

const source = argv.source ?? 'har';
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
    // emitThresholds expects Record<string, {p95, count, ...}>
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
```

- [ ] **Step 5: Run all tests — expect passing**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/emitter.test.js tests/parser.test.js tests/routes.test.js tests/stats.test.js tests/integration.test.js tests/sources/har.test.js tests/sources/k6.test.js
```
Expected: all passing (existing 20 + new tests).

- [ ] **Step 6: Commit**

```bash
git add src/cli.js tests/integration.test.js
git commit -m "feat: add --source flag routing to cli.js (har/k6/logs/otel/prometheus)"
```

---

## Task 4: logs source

**Files:**
- Create: `src/sources/logs.js`
- Create: `tests/sources/logs.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/sources/logs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/logs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NGINX_FIXTURE = join(__dirname, '..', 'fixtures', 'nginx-sample.log');

test('ingest logs returns GroupStats array from nginx fixture', async () => {
  const groups = await ingest({ input: NGINX_FIXTURE });
  assert.ok(Array.isArray(groups) && groups.length > 0, 'should return non-empty array');
});

test('ingest logs collapses /api/users/1 and /api/users/3 into same template', async () => {
  const groups = await ingest({ input: NGINX_FIXTURE });
  const userGroup = groups.find(g => g.template.includes('{id}') && g.method === 'GET');
  assert.ok(userGroup, 'collapsed user group should exist');
  assert.ok(userGroup.count >= 2, 'should have multiple observations');
});

test('ingest logs GroupStats has p95 > 0', async () => {
  const groups = await ingest({ input: NGINX_FIXTURE });
  assert.ok(groups.every(g => g.p95 > 0), 'all groups must have positive p95');
});

test('ingest logs throws when --input missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});

test('ingest logs auto-detects NDJSON format', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');
  const tmp = j(tmpdir(), 'test-ndjson.log');
  writeFileSync(tmp, [
    JSON.stringify({ method: 'GET', path: '/api/items/1', status: 200, duration_ms: 120 }),
    JSON.stringify({ method: 'GET', path: '/api/items/2', status: 200, duration_ms: 95 }),
    JSON.stringify({ method: 'POST', path: '/api/orders', status: 201, duration_ms: 450 }),
  ].join('\n'));
  try {
    const groups = await ingest({ input: tmp });
    assert.ok(groups.length > 0, 'NDJSON should produce groups');
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
});
```

- [ ] **Step 2: Run — expect failure**

```bash
node --test tests/sources/logs.test.js
```

- [ ] **Step 3: Create `src/sources/logs.js`**

```javascript
// src/sources/logs.js
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { collapseUrl } from '../routes.js';
import { computeGroups } from '../stats.js';

// ── Format-specific line parsers ─────────────────────────────────────────────

// nginx Combined/Common: "IP - - [date] "METHOD /path HTTP/x" STATUS SIZE [RESPONSE_TIME]"
const NGINX_RE = /^\S+ \S+ \S+ \[[^\]]+\] "(\w+) ([^\s"]+)[^"]*" (\d{3}) \d+(?:\s+"[^"]*")*(?:\s+"[^"]*")?\s*([\d.]+)?$/;

function parseNginxLine(line) {
  const m = NGINX_RE.exec(line);
  if (!m) return null;
  const [, method, fullPath, status, reqTimeSec] = m;
  const path = fullPath.split('?')[0];
  const time = reqTimeSec ? Math.round(parseFloat(reqTimeSec) * 1000) : 0;
  if (time <= 0) return null;
  return { method: method.toUpperCase(), path, status: parseInt(status, 10), time };
}

// AWS ALB: space-separated, request at index 12, target_processing_time at index 7
function parseAlbLine(line) {
  if (!line || line.startsWith('#')) return null;
  const parts = line.split(' ');
  if (parts.length < 13) return null;
  try {
    const reqTime = parseFloat(parts[7]);
    const reqField = parts[12].replace(/"/g, '');
    const [, method, fullUrl] = reqField.split(' ');
    if (!method || !fullUrl) return null;
    const path = fullUrl.startsWith('http') ? new URL(fullUrl).pathname : fullUrl.split('?')[0];
    const status = parseInt(parts[9], 10);
    return { method: method.toUpperCase(), path, status, time: Math.round(reqTime * 1000) };
  } catch { return null; }
}

// NDJSON: any JSON line with method/path/status/duration fields
const METHOD_KEYS   = ['method', 'http_method', 'verb'];
const PATH_KEYS     = ['path', 'url', 'request_path', 'uri'];
const STATUS_KEYS   = ['status', 'status_code', 'http_status'];
const DURATION_KEYS = ['duration_ms', 'duration', 'response_time', 'elapsed', 'time_ms'];

function pick(obj, keys) {
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

function parseNdjsonLine(line) {
  if (!line) return null;
  try {
    const obj = JSON.parse(line);
    const method   = pick(obj, METHOD_KEYS);
    let   path     = pick(obj, PATH_KEYS);
    const status   = parseInt(pick(obj, STATUS_KEYS), 10);
    let   duration = parseFloat(pick(obj, DURATION_KEYS) ?? '0');
    if (!method || !path || isNaN(status) || duration <= 0) return null;
    path = path.split('?')[0];
    if (duration < 10) duration = duration * 1000; // assume seconds if < 10
    return { method: method.toUpperCase(), path, status, time: Math.round(duration) };
  } catch { return null; }
}

function detectFormat(firstLine) {
  if (!firstLine) return 'nginx';
  if (firstLine.startsWith('{')) return 'ndjson';
  if (/^(https? |h2 |grpc |ws )/.test(firstLine)) return 'alb';
  return 'nginx';
}

// ── Main ingest ───────────────────────────────────────────────────────────────

/**
 * Ingest an access log file (nginx/ALB/NDJSON) and return GroupStats[].
 * @param {{ input: string }} argv
 */
export async function ingest(argv) {
  if (!argv.input) {
    throw new Error('--input <path-to-log-file> is required for --source logs');
  }

  const entries = [];
  const rl = createInterface({
    input: createReadStream(argv.input, 'utf8'),
    crlfDelay: Infinity,
  });

  let fmt = null;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (fmt === null) fmt = detectFormat(trimmed);

    const parsers = { nginx: parseNginxLine, alb: parseAlbLine, ndjson: parseNdjsonLine };
    const entry = parsers[fmt](trimmed);
    if (!entry) continue;

    // Convert path to URL for collapseUrl
    const fakeUrl = `https://host${entry.path}`;
    entries.push({ method: entry.method, url: fakeUrl, status: entry.status, time: entry.time });
  }

  return Object.values(computeGroups(entries, collapseUrl));
}
```

- [ ] **Step 4: Run — expect 5 passing**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/sources/logs.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/sources/logs.js tests/sources/logs.test.js
git commit -m "feat(source): add --source logs for nginx/ALB/NDJSON access logs"
```

---

## Task 5: OTEL source + fixture

**Files:**
- Create: `tests/fixtures/traces.jsonl`
- Create: `src/sources/otel.js`
- Create: `tests/sources/otel.test.js`

- [ ] **Step 1: Create `tests/fixtures/traces.jsonl`**

```
{"traceId":"aaa","spanId":"1","name":"GET /api/users/:id","kind":"SPAN_KIND_SERVER","durationNano":245300000,"attributes":{"http.method":"GET","http.route":"/api/users/{id}","http.status_code":200}}
{"traceId":"aaa","spanId":"2","name":"GET /api/users/:id","kind":"SPAN_KIND_SERVER","durationNano":182100000,"attributes":{"http.method":"GET","http.route":"/api/users/{id}","http.status_code":200}}
{"traceId":"bbb","spanId":"3","name":"POST /api/orders","kind":"SPAN_KIND_SERVER","durationNano":650000000,"attributes":{"http.method":"POST","http.route":"/api/orders","http.status_code":201}}
{"traceId":"ccc","spanId":"4","name":"internal-cache-lookup","kind":"SPAN_KIND_INTERNAL","durationNano":5000000,"attributes":{}}
{"traceId":"ddd","spanId":"5","name":"GET /api/users/:id","kind":"SERVER","durationNano":310500000,"attributes":{"http.method":"GET","http.route":"/api/users/{id}","http.status_code":200}}
{"traceId":"eee","spanId":"6","name":"GET /health","kind":2,"durationNano":12000000,"attributes":{"http.method":"GET","http.route":"/health","http.status_code":200}}
```

- [ ] **Step 2: Write failing test**

```javascript
// tests/sources/otel.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from '../../src/sources/otel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'traces.jsonl');

test('ingest otel filters out INTERNAL spans', async () => {
  const groups = await ingest({ input: FIXTURE });
  const keys = groups.map(g => g.key);
  assert.ok(!keys.some(k => k.includes('cache-lookup')), 'INTERNAL span must be filtered');
});

test('ingest otel groups 3 SERVER GET /api/users spans into one template', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/api/users/{id}' && g.method === 'GET');
  assert.ok(userGroup, 'GET /api/users/{id} group should exist');
  assert.equal(userGroup.count, 3, 'should have 3 observations');
});

test('ingest otel converts durationNano to ms correctly', async () => {
  const groups = await ingest({ input: FIXTURE });
  const userGroup = groups.find(g => g.template === '/api/users/{id}');
  // 245.3ms, 182.1ms, 310.5ms → p95 should be ≈ 310ms
  assert.ok(userGroup.p95 >= 280 && userGroup.p95 <= 320,
    `p95=${userGroup.p95} should be ~310ms`);
});

test('ingest otel accepts numeric kind=2 (SERVER)', async () => {
  const groups = await ingest({ input: FIXTURE });
  // span with kind:2 and route /health should be included
  const healthGroup = groups.find(g => g.template === '/health');
  assert.ok(healthGroup, '/health span with kind=2 should be included');
});

test('ingest otel accepts string kind="SERVER"', async () => {
  const groups = await ingest({ input: FIXTURE });
  // the span with kind:"SERVER" (not "SPAN_KIND_SERVER") must be included
  const userGroup = groups.find(g => g.template === '/api/users/{id}');
  assert.equal(userGroup.count, 3); // includes the "SERVER" variant
});

test('ingest otel throws when --input missing', async () => {
  await assert.rejects(() => ingest({}), /--input/);
});
```

- [ ] **Step 3: Run — expect failure**

```bash
node --test tests/sources/otel.test.js
```

- [ ] **Step 4: Create `src/sources/otel.js`**

```javascript
// src/sources/otel.js
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { collapseUrl } from '../routes.js';
import { computeGroups } from '../stats.js';

// Accepted SERVER span kind values (string and numeric)
const SERVER_KINDS = new Set(['SPAN_KIND_SERVER', 'SERVER', 2, '2']);

/**
 * Ingest an OpenTelemetry trace JSONL export and return GroupStats[].
 * Filters to SERVER spans only. Converts durationNano → ms.
 * @param {{ input: string }} argv
 */
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

    // Filter to server-side inbound spans
    if (!SERVER_KINDS.has(span.kind)) continue;

    const attrs   = span.attributes ?? {};
    const method  = (attrs['http.method'] ?? 'GET').toUpperCase();
    const rawPath = attrs['http.route'] ?? attrs['http.target'] ?? span.name ?? '';
    if (!rawPath) continue;

    const durationMs = (span.durationNano ?? 0) / 1_000_000;
    if (durationMs <= 0) continue;

    const fakeUrl = rawPath.startsWith('http') ? rawPath : `https://host${rawPath}`;
    entries.push({
      method,
      url:    fakeUrl,
      status: attrs['http.status_code'] ?? 200,
      time:   durationMs,
    });
  }

  return Object.values(computeGroups(entries, collapseUrl));
}
```

- [ ] **Step 5: Run — expect 6 passing**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/sources/otel.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/sources/otel.js tests/sources/otel.test.js tests/fixtures/traces.jsonl
git commit -m "feat(source): add --source otel for OpenTelemetry trace JSONL"
```

---

## Task 6: Prometheus source

**Files:**
- Create: `src/sources/prometheus.js`
- Create: `tests/sources/prometheus.test.js`

- [ ] **Step 1: Write failing test with mock HTTP server**

```javascript
// tests/sources/prometheus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ingest } from '../../src/sources/prometheus.js';

// Spin up a minimal Prometheus-compatible mock server
function startMockProm(responses) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('query') ?? '';

      // labels endpoint
      if (url.pathname === '/api/v1/labels') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'success',
          data: ['__name__', 'http_route', 'job', 'instance'],
        }));
      }

      // instant query
      if (url.pathname === '/api/v1/query') {
        const response = responses[query] ?? {
          status: 'success',
          data: { resultType: 'vector', result: [] },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(response));
      }

      res.writeHead(404); res.end();
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

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

test('ingest prometheus discovers http_route label and returns GroupStats', async () => {
  const responses = {
    // histogram_quantile(0.95, ...) returns p95 per route in seconds
    [Symbol.iterator]: undefined, // handled below via includes check
  };

  // Use a simple approach: respond to any histogram_quantile query
  const srv = await startMockProm({});
  const srvWithRoutes = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('query') ?? '';

      if (url.pathname === '/api/v1/labels') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'success', data: ['http_route', '__name__'] }));
      }

      if (url.pathname === '/api/v1/query') {
        if (query.includes('histogram_quantile') && query.includes('0.95')) {
          return res.end(JSON.stringify(makeHistogramResponse([
            { route: '/api/users/{id}', value: 0.245 },  // 245ms
            { route: '/api/orders',     value: 0.780 },  // 780ms
          ])));
        }
        // Other quantile queries or count — return empty
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'success',
          data: { resultType: 'vector', result: [] },
        }));
      }
      res.writeHead(404); res.end();
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  srv.close();

  const addr = srvWithRoutes.address();
  try {
    const groups = await ingest({
      url: `http://127.0.0.1:${addr.port}`,
      query: 'http_request_duration_seconds',
      range: '7d',
      step: '1h',
    });

    assert.ok(Array.isArray(groups), 'should return array');
    assert.ok(groups.length > 0, 'should have groups');

    const ordersGroup = groups.find(g => g.template === '/api/orders');
    assert.ok(ordersGroup, 'POST /api/orders group should exist');
    // 780ms from Prometheus (0.780s)
    assert.ok(ordersGroup.p95 >= 775 && ordersGroup.p95 <= 785,
      `p95=${ordersGroup.p95} should be ~780ms`);
  } finally {
    srvWithRoutes.close();
  }
});

test('ingest prometheus converts seconds to milliseconds', async () => {
  const srv = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('query') ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (url.pathname === '/api/v1/labels')
        return res.end(JSON.stringify({ status: 'success', data: ['http_route'] }));
      if (query.includes('0.95'))
        return res.end(JSON.stringify(makeHistogramResponse([{ route: '/ping', value: 0.050 }])));
      res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
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
```

- [ ] **Step 2: Run — expect failure**

```bash
node --test tests/sources/prometheus.test.js
```

- [ ] **Step 3: Create `src/sources/prometheus.js`**

```javascript
// src/sources/prometheus.js
import { get as httpGet }  from 'node:http';
import { get as httpsGet } from 'node:https';
import { URL }             from 'node:url';
import { collapseUrl }     from '../routes.js';

// Label names tried in order for route discovery
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

/**
 * Ingest Prometheus/Mimir via HTTP API and return GroupStats[].
 * @param {{ url: string, query: string, range?: string, step?: string, 'prom-header'?: string }} argv
 */
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

  // Query all 4 percentiles
  const percentiles = { p50: 0.50, p75: 0.75, p95: 0.95, p99: 0.99 };
  const pctResults = {};
  for (const [name, q] of Object.entries(percentiles)) {
    const promQuery =
      `histogram_quantile(${q}, sum by (le, ${routeLabel}) ` +
      `(rate(${argv.query}_bucket[${range}])))`;
    pctResults[name] = await queryInstant(argv.url, promQuery, headers);
  }

  // Query observation count
  const countQuery =
    `sum by (${routeLabel}) (increase(${argv.query}_count[${range}]))`;
  const countResults = await queryInstant(argv.url, countQuery, headers);
  const countMap = Object.fromEntries(
    countResults.map(r => [r.metric[routeLabel] ?? '', Math.round(parseFloat(r.value[1]) || 1)])
  );

  // Build GroupStats from p95 results (most complete)
  const groups = [];
  for (const item of pctResults.p95) {
    const rawRoute = item.metric[routeLabel] ?? '';
    if (!rawRoute) continue;

    const p95Ms = Math.round(parseFloat(item.value[1]) * 1000);
    if (p95Ms <= 0) continue;

    const fakeUrl  = rawRoute.startsWith('http') ? rawRoute : `https://host${rawRoute}`;
    const template = collapseUrl(fakeUrl);
    const method   = item.metric.method ?? item.metric.http_method ?? 'GET';
    const key      = `${method.toUpperCase()} ${template}`;
    const count    = countMap[rawRoute] ?? 1;

    // Look up other percentiles for this route
    const getP = (name) => {
      const r = pctResults[name].find(x => x.metric[routeLabel] === rawRoute);
      return r ? Math.round(parseFloat(r.value[1]) * 1000) : 0;
    };

    groups.push({
      key, method: method.toUpperCase(), template, count,
      p50: getP('p50'), p75: getP('p75'), p95: p95Ms, p99: getP('p99'),
      min: 0,  // Prometheus histograms don't expose min/max
      max: 0,
    });
  }

  return groups;
}
```

- [ ] **Step 4: Run — expect 4 passing**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test tests/sources/prometheus.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/sources/prometheus.js tests/sources/prometheus.test.js
git commit -m "feat(source): add --source prometheus for Prometheus/Mimir HTTP API"
```

---

## Task 7: Full test suite + README update + CHANGELOG prep

**Files:**
- Modify: `tests/integration.test.js` (add otel + prometheus smoke tests)
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json` (bump to 0.1.0)

- [ ] **Step 1: Add otel and logs integration tests**

Add to the end of `tests/integration.test.js`:

```javascript
// At top of file, add imports if not already present:
// import { join as joinPath, dirname as dirName } from 'node:path';
// import { fileURLToPath as fileToUrl } from 'node:url';
// const __dir = dirName(fileToUrl(import.meta.url));

const OTEL_FIXTURE  = joinPath(__dir, 'fixtures', 'traces.jsonl');
const LOGS_FIXTURE  = joinPath(__dir, 'fixtures', 'nginx-sample.log');

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
```

- [ ] **Step 2: Run full test suite — all must pass**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
node --test \
  tests/emitter.test.js \
  tests/parser.test.js \
  tests/routes.test.js \
  tests/stats.test.js \
  tests/integration.test.js \
  tests/sources/har.test.js \
  tests/sources/k6.test.js \
  tests/sources/logs.test.js \
  tests/sources/otel.test.js \
  tests/sources/prometheus.test.js
```
Expected: all passing.

- [ ] **Step 3: Update `CHANGELOG.md`**

Replace `## [Unreleased]` section:
```markdown
## [Unreleased]

## [0.1.0] - 2026-06-11

### Added
- `--source k6` — derive SLO thresholds from k6 `--summary-export` JSON output
- `--source logs` — derive thresholds from nginx, Apache, ALB, or NDJSON access logs
- `--source otel` — derive thresholds from OpenTelemetry trace JSONL exports
- `--source prometheus` — derive thresholds from live Prometheus/Mimir HTTP API
- `--url`, `--query`, `--range`, `--step`, `--prom-header` flags for Prometheus source
- Backward compatible: `har-to-slo --input recording.har` unchanged (--source har is default)
```

- [ ] **Step 4: Update `README.md` — add multi-source section**

After the `## Usage` section, add:

````markdown
## Supported sources

| Source | Command | What it reads |
|---|---|---|
| `har` (default) | `har-to-slo --input recording.har` | HAR file timing data |
| `k6` | `har-to-slo --source k6 --input summary.json` | k6 `--summary-export` JSON |
| `logs` | `har-to-slo --source logs --input nginx.log` | nginx / ALB / NDJSON access logs |
| `otel` | `har-to-slo --source otel --input traces.jsonl` | OpenTelemetry trace JSONL export |
| `prometheus` | `har-to-slo --source prometheus --url http://prom:9090 --query http_request_duration_seconds` | Prometheus / Mimir HTTP API |

### Using with the Grafana stack

```bash
# From a k6 load test run
k6 run --summary-export summary.json load-test.js
har-to-slo --source k6 --input summary.json

# From Grafana Mimir (or any Prometheus)
har-to-slo --source prometheus \
  --url http://mimir.internal:9090 \
  --query http_request_duration_seconds \
  --range 30d

# From Grafana Tempo trace export (OTEL JSONL)
har-to-slo --source otel --input tempo-export.jsonl
```
````

- [ ] **Step 5: Bump version to 0.1.0**

In `package.json`, change `"version": "0.0.3"` to `"version": "0.1.0"`.

Wait — do NOT manually bump here. The release workflow handles versioning. Instead, add a note to CHANGELOG and let the release workflow do `npm version minor` when you run it.

Revert the package.json version change if made. Just ensure CHANGELOG has the `[Unreleased]` section ready for the release workflow to roll.

- [ ] **Step 6: Final commit**

```bash
cd C:\Users\AdityaKumarSingh\har-to-k6-thresholds
git add tests/integration.test.js README.md CHANGELOG.md
git commit -m "docs: update README + CHANGELOG for v0.1.0 multi-source expansion"
```

---

## Self-Review

**Spec coverage:**
- [x] `src/sources/har.js` wrapping existing parser → Task 1
- [x] `src/sources/k6.js` with tag extraction + weighted p95 → Task 2
- [x] `--source` flag + dynamic routing in cli.js → Task 3
- [x] `src/sources/logs.js` nginx/ALB/NDJSON auto-detect → Task 4
- [x] `src/sources/otel.js` SERVER filter + durationNano→ms → Task 5
- [x] `src/sources/prometheus.js` label discovery + histogram_quantile → Task 6
- [x] GroupStats schema consistent across all sources → all tasks ✓
- [x] Backward compatibility (default --source har) → Task 3 + integration test
- [x] `--url`, `--query`, `--range`, `--step`, `--prom-header` flags → Task 3 cli.js
- [x] Unit conversion: Prometheus seconds→ms → Task 6 (`* 1000`)
- [x] OTEL numeric kind=2 accepted → Task 5 `SERVER_KINDS` set
- [x] OTEL streaming (readline) for large files → Task 5
- [x] Release order v0.1.0 → v0.4.0 → Task 7 CHANGELOG

**Placeholder scan:** None found.

**Type consistency:**
- `ingest(argv)` returns `GroupStats[]` — all tasks ✓
- `GroupStats` has `{key, method, template, count, p50, p75, p95, p99, min, max}` — all tasks ✓
- `cli.js` uses `Object.fromEntries(groups.map(g => [g.key, g]))` to convert `GroupStats[]` → Record before passing to `emitThresholds` — consistent ✓
- `collapseUrl` takes a full URL string (including scheme) — all sources prepend `https://host` when only a path is available — consistent ✓
