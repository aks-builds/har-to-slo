# har-to-k6-thresholds

> Convert HAR timing data into k6 thresholds baselines — no more guessing SLOs

[![npm version](https://badge.fury.io/js/har-to-k6-thresholds.svg)](https://www.npmjs.com/package/har-to-k6-thresholds)
[![CI](https://github.com/aks-builds/har-to-k6-thresholds/actions/workflows/ci.yml/badge.svg)](https://github.com/aks-builds/har-to-k6-thresholds/actions/workflows/ci.yml)

`grafana/har-to-k6` discards every timing measurement in the HAR file and emits no thresholds. This tool treats the HAR as **measurement data** — it computes p95 baselines per route and outputs a ready-to-use k6 `thresholds {}` block.

## Install

```bash
npx har-to-k6-thresholds --input recording.har
```

## Usage

```bash
# Basic — outputs k6 thresholds block to stdout
npx har-to-k6-thresholds --input recording.har

# Stricter SLOs (1.2× p95)
npx har-to-k6-thresholds --input recording.har --multiplier 1.2

# JSON output for CI pipelines
npx har-to-k6-thresholds --input recording.har --format json

# Write to file
npx har-to-k6-thresholds --input recording.har --output k6/thresholds.js
```

## How it works

1. Reads every HAR entry's `.time` value (total request duration in ms)
2. Collapses parameterised URLs: `/users/123` → `/users/{id}`
3. Groups by `METHOD /template`
4. Trims top 5% outliers, computes p50/p75/p95/p99
5. Sets threshold = `Math.round(p95 × multiplier)` per group
6. Emits a valid k6 `export const options = { thresholds: {...} }` block

## License

MIT © aks-builds
