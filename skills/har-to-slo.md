---
name: har-to-slo
description: Turn HAR timing measurements into k6 SLO baselines. Computes p95 per route, applies configurable multiplier, outputs a ready-to-use thresholds{} block. Your recordings already know your p95.
version: 0.0.1
tools:
  - Bash
  - Read
  - Write
---

# har-to-slo

Convert a HAR file's measured timing data into a ready-to-use k6 `thresholds {}` block.

## When to use
- You have a HAR file from a browser session, Playwright recording, or API gateway export
- You need to set k6 thresholds but don't know what values to use
- You want your load test SLOs grounded in real observed latency, not guesses

## How to use

```bash
# Basic — outputs k6 thresholds block to stdout
npx har-to-slo --input recording.har

# Stricter SLOs (1.2× p95 instead of default 1.5×)
npx har-to-slo --input recording.har --multiplier 1.2

# JSON output for CI pipelines
npx har-to-slo --input recording.har --format json

# Write directly to a k6 script file
npx har-to-slo --input recording.har --output k6/thresholds.js

# With LLM rationale annotations (requires ANTHROPIC_API_KEY)
npx har-to-slo --input recording.har --explain
```

## What it does
1. Reads every HAR entry's `.time` value (total request duration in ms)
2. Collapses parameterised URLs: `/users/123` → `/users/{id}`
3. Groups by `METHOD /template`
4. Trims top 5% outliers, then computes p50/p75/p95/p99
5. Sets threshold = `Math.round(p95 × multiplier)` per group
6. Emits a valid k6 `export const options = { thresholds: {...} }` block

## Output example
```javascript
export const options = {
  thresholds: {
    // GET /users/{id} — p95 baseline: 245ms (n=847, ×1.5)
    "http_req_duration{scenario:GET_users__id_}": ["p(95)<368"],
    // POST /orders — p95 baseline: 890ms (n=312, ×1.5)
    "http_req_duration{scenario:POST_orders}": ["p(95)<1335"],
  },
};
```
