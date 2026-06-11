# har-to-slo — Multi-Source Expansion Design
**Date:** 2026-06-11
**Status:** Approved
**Goal:** Expand har-to-slo from a single HAR-only tool into a multi-source SLO baseline platform that derives k6 thresholds from any latency data source in the Grafana stack — HAR, k6 output, Prometheus/Mimir, OpenTelemetry traces, and access logs.

---

## Context

`har-to-slo@0.0.3` is live on npm. It reads HAR timing data and outputs a k6 `thresholds {}` block. The expansion adds four new data sources via a `--source` flag while keeping full backward compatibility with the existing HAR interface.

**Strategy:** Organic discovery by Grafana Labs engineers — no outreach. Each new source is a natural search result for k6 + its data origin:
- `--source k6` → "k6 threshold from k6 output"
- `--source prometheus` → "k6 thresholds from Prometheus" (Mimir is Grafana's core product)
- `--source otel` → "k6 thresholds from OpenTelemetry Tempo"
- `--source logs` → "k6 thresholds from nginx logs"

---

## 1. Architecture

Single entry point: `npx har-to-slo`. New `--source` flag routes to a source module. All sources produce the same `GroupStats[]` structure consumed unchanged by the existing `stats.js`, `emitter.js`, and `--explain` pipeline.

```
src/
├── sources/
│   ├── har.js          # existing HAR ingestion (default --source har)
│   ├── k6.js           # NEW: k6 --summary-export JSON
│   ├── prometheus.js   # NEW: Prometheus/Mimir HTTP API query
│   ├── otel.js         # NEW: OpenTelemetry trace JSONL
│   └── logs.js         # NEW: nginx/Apache/ALB/NDJSON access logs
├── parser.js           # unchanged (HAR parsing, used by sources/har.js)
├── routes.js           # unchanged (shared URL collapsing)
├── stats.js            # unchanged (GroupStats computation)
├── emitter.js          # unchanged (k6 thresholds{} output)
├── explain.js          # unchanged (optional LLM annotation)
└── cli.js              # updated: --source flag + dynamic source routing
```

---

## 2. Source Interface Contract

Every source exports a single async function:

```javascript
// src/sources/<name>.js
export async function ingest(argv: object): Promise<GroupStats[]>
```

`argv` is the full parsed CLI flags object. Each source reads the flags it needs and returns `GroupStats[]`.

### GroupStats schema

```javascript
{
  key:      string,   // "GET /api/users/{id}" — method + collapsed template
  method:   string,   // HTTP method, uppercase
  template: string,   // collapsed URL path e.g. "/api/users/{id}"
  count:    number,   // total observations in the data source
  p50:      number,   // milliseconds
  p75:      number,
  p95:      number,   // used for threshold computation
  p99:      number,
  min:      number,
  max:      number,
}
```

---

## 3. Source: `har` (existing, refactored)

**No behaviour change.** `src/parser.js` + route collapsing logic extracted into `src/sources/har.js`. The `ingest()` wrapper calls `parseHarFile(argv.input)` → `computeGroups()` → returns `GroupStats[]`.

Requires: `--input <path>` (HAR file).

---

## 4. Source: `k6`

**Input:** k6 `--summary-export` JSON file.

```bash
k6 run --summary-export summary.json load-test.js
har-to-slo --source k6 --input summary.json
```

**k6 summary schema** (relevant portion):
```json
{
  "metrics": {
    "http_req_duration{url:https://api.example.com/users/1,method:GET}": {
      "type": "trend",
      "values": {
        "p(90)": 210.5, "p(95)": 245.0, "p(99)": 380.2,
        "med": 120.0, "count": 847, "min": 45.0, "max": 890.0
      }
    }
  }
}
```

**Ingestion logic (`src/sources/k6.js`):**
1. Parse JSON, iterate `metrics` entries
2. Filter: `value.type === "trend"` AND key starts with `"http_req_duration"`
3. Extract `url` tag value from the metric key (regex: `/url:([^,}]+)/`)
4. Extract `method` tag if present (regex: `/method:([A-Z]+)/`), default `"GET"`
5. Run URL through `collapseUrl()` from `routes.js`
6. Group by `METHOD /template` key (multiple raw URLs collapse to same template)
7. Within each group: p95 = average of individual p95 values weighted by count; count = sum
8. Return `GroupStats[]`

Requires: `--input <path>` (k6 summary JSON file).

---

## 5. Source: `prometheus`

**Input:** Live Prometheus or Mimir HTTP API.

```bash
har-to-slo --source prometheus \
  --url http://localhost:9090 \
  --query http_request_duration_seconds \
  --range 7d \
  --step 1h
```

**Ingestion logic (`src/sources/prometheus.js`):**

1. **Auto-discover route label:** Query Prometheus label names for the metric: `GET /api/v1/labels` filtered by `{__name__="<query>"}`. Try label names in priority order: `http_route`, `route`, `handler`, `path`, `url`, `endpoint`. Use the first one found.

2. **Query p95 per label value:**
   ```
   histogram_quantile(0.95,
     sum by (le, <route_label>) (
       rate(<query>_bucket[<range>])
     )
   )
   ```
   via `GET /api/v1/query` (instant query, evaluates at `now`).

3. **Query count per label value:**
   ```
   sum by (<route_label>) (increase(<query>_count[<range>]))
   ```

4. **Convert units:** Prometheus histograms are in seconds → multiply by 1000 for milliseconds.

5. **Run route label value through `collapseUrl()`** (Prometheus `http_route` labels may already be parameterised, but we normalise anyway).

6. For p50/p75/p99: issue additional `histogram_quantile` queries (0.50, 0.75, 0.99).

7. Return `GroupStats[]`.

Requires: `--url <prometheus-endpoint>` and `--query <metric-name>`.

**Optional flags:**
- `--range` (default: `7d`) — lookback window
- `--step` (default: `1h`) — query resolution
- `--prom-header "Authorization: Bearer <token>"` — pass auth header to Prometheus API

**Dependencies:** `node:https` / `node:http` only — no external HTTP client, keeping zero hard dependencies.

---

## 6. Source: `otel`

**Input:** OpenTelemetry trace JSONL export (one span per line).

```bash
har-to-slo --source otel --input traces.jsonl
```

**OTEL span schema** (relevant fields):
```json
{
  "traceId": "...",
  "spanId": "...",
  "name": "GET /api/users/:id",
  "kind": "SPAN_KIND_SERVER",
  "durationNano": 245300000,
  "status": { "code": "STATUS_CODE_OK" },
  "attributes": {
    "http.method": "GET",
    "http.route": "/api/users/{id}",
    "http.status_code": 200
  }
}
```

**Ingestion logic (`src/sources/otel.js`):**
1. Read file line-by-line using `readline` (streaming — trace exports can be 100MB+)
2. Filter: `kind` must be `"SPAN_KIND_SERVER"` or `"SERVER"` or `2` (numeric form)
3. Extract route: `attributes["http.route"]` → fallback to `attributes["http.target"]` → fallback to span `name`
4. Extract method: `attributes["http.method"]` → fallback to `"GET"`
5. Convert `durationNano` (nanoseconds) → milliseconds (divide by 1,000,000)
6. Skip spans with `durationNano <= 0` or missing duration
7. Run route through `collapseUrl()` for normalisation
8. Accumulate raw timing arrays per `METHOD /template` group
9. After all lines: run each group through `computeGroups()` (re-uses existing stats engine)
10. Return `GroupStats[]`

Requires: `--input <path>` (OTEL JSONL file).

---

## 7. Source: `logs`

**Input:** nginx, Apache, ALB, or NDJSON access log files.

```bash
har-to-slo --source logs --input nginx-access.log
har-to-slo --source logs --input alb-access.log
har-to-slo --source logs --input app.ndjson
```

**Ingestion logic (`src/sources/logs.js`):**
- Re-uses the **exact same parsers** from `logreplay-to-tests` design (nginx, ALB, NDJSON)
- Auto-detects format from first non-empty line (NDJSON if starts with `{`, ALB if starts with `http`/`h2`/`ws`, nginx otherwise)
- Each parsed line → `{ method, path, status, time }` entry
- Entries fed through `collapseUrl()` + `computeGroups()` (re-uses existing stats engine)
- Returns `GroupStats[]`

Requires: `--input <path>` (access log file).

---

## 8. CLI Changes

### New flags

| Flag | Short | Type | Default | Used by |
|---|---|---|---|---|
| `--source` | `-s` | string | `har` | all |
| `--url` | | string | | prometheus |
| `--query` | `-Q` | string | | prometheus |
| `--range` | | string | `7d` | prometheus |
| `--step` | | string | `1h` | prometheus |
| `--prom-header` | | string | | prometheus |

### Source routing in `src/cli.js`

```javascript
const SOURCES = {
  har:        () => import('./sources/har.js'),
  k6:         () => import('./sources/k6.js'),
  prometheus: () => import('./sources/prometheus.js'),
  otel:       () => import('./sources/otel.js'),
  logs:       () => import('./sources/logs.js'),
};

const source = argv.source ?? 'har';
if (!SOURCES[source]) {
  process.stderr.write(`Error: unknown --source "${source}". Use: har, k6, prometheus, otel, logs\n`);
  process.exit(1);
}
const { ingest } = await SOURCES[source]();
const groups = await ingest(argv);
```

### Backward compatibility

`har-to-slo --input recording.har` is fully equivalent to `har-to-slo --source har --input recording.har`. No existing flags are removed, renamed, or changed in behaviour.

---

## 9. Testing Strategy

Each source gets its own test file with a fixture:

| Test file | Fixture | What it verifies |
|---|---|---|
| `tests/sources/har.test.js` | `tests/fixtures/sample.har` | Existing HAR tests moved here |
| `tests/sources/k6.test.js` | `tests/fixtures/k6-summary.json` | Tag extraction, URL collapsing, p95 mapping |
| `tests/sources/prometheus.test.js` | Mock HTTP server | Label discovery, histogram_quantile query, unit conversion |
| `tests/sources/otel.test.js` | `tests/fixtures/traces.jsonl` | SERVER span filter, durationNano → ms, JSONL streaming |
| `tests/sources/logs.test.js` | `tests/fixtures/nginx-sample.log` | Format auto-detect, route collapsing, GroupStats output |
| `tests/integration.test.js` | All fixtures | End-to-end CLI for all 5 `--source` values |

---

## 10. Release Strategy

| Phase | What ships | npm version |
|---|---|---|
| v0.1.0 | `--source k6` + refactored `--source har` | patch → minor (new feature) |
| v0.2.0 | `--source logs` | minor |
| v0.3.0 | `--source otel` | minor |
| v0.4.0 | `--source prometheus` | minor |
| v1.0.0 | All 5 sources stable, README updated | major |

---

## Self-Review

**Placeholder scan:** None found. All sections complete.

**Consistency:** `GroupStats` schema used identically across all source descriptions. `collapseUrl()` from `routes.js` referenced consistently. `computeGroups()` from `stats.js` referenced in otel and logs sources. ✓

**Scope:** Five independent source modules + CLI flag addition. Appropriately scoped for a single plan — each source can be its own task.

**Ambiguity fixes:**
- Prometheus source: p50/p75/p99 require additional queries (explicitly stated in step 6)
- OTEL `kind` field: accepts `"SPAN_KIND_SERVER"`, `"SERVER"`, and `2` (numeric) — all common in real exports
- Logs source: format auto-detection rules explicitly ordered (NDJSON check before ALB before nginx)
