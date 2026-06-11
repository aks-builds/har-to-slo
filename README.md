<div align="center">

# ⏱ har-to-k6-thresholds

**Your HAR file already has the SLO data — you just haven't used it yet.**

`grafana/har-to-k6` discards every timing measurement in the HAR and emits no thresholds block.
This tool treats the HAR as **measurement data** — computes p95 baselines per route, applies a configurable multiplier,
and outputs a ready-to-paste k6 `thresholds {}` block. Stop guessing your SLOs.

[![CI](https://github.com/aks-builds/har-to-k6-thresholds/actions/workflows/ci.yml/badge.svg)](https://github.com/aks-builds/har-to-k6-thresholds/actions/workflows/ci.yml)
[![CodeQL](https://github.com/aks-builds/har-to-k6-thresholds/actions/workflows/codeql.yml/badge.svg)](https://github.com/aks-builds/har-to-k6-thresholds/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/har-to-k6-thresholds.svg)](https://www.npmjs.com/package/har-to-k6-thresholds)
[![License MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Agent Skill](https://img.shields.io/badge/agent-skill-8a2be2.svg)](skills/har-to-k6-thresholds.md)

<br/>

![har-to-k6-thresholds running against a real HAR file — 6 routes, p95 baselines with 1.5× multiplier applied](.github/media/demo.svg)

<sub>☝️ A real har-to-k6-thresholds run — generated from a 48-entry HAR with 6 routes, zero configuration.</sub>

</div>

---

## Install

```bash
npx har-to-k6-thresholds --input recording.har
```

No install needed. Run directly with `npx`.

---

## Usage

```bash
# Basic — outputs k6 thresholds block to stdout
npx har-to-k6-thresholds --input recording.har

# Stricter SLOs (1.2× p95 instead of default 1.5×)
npx har-to-k6-thresholds --input recording.har --multiplier 1.2

# JSON output for CI pipelines and tooling
npx har-to-k6-thresholds --input recording.har --format json

# Write directly to a k6 script file
npx har-to-k6-thresholds --input recording.har --output k6/thresholds.js

# Annotate thresholds with LLM rationale (requires ANTHROPIC_API_KEY)
npx har-to-k6-thresholds --input recording.har --explain
```

---

## How it works

1. Reads every HAR entry's `.time` field (total request duration in ms)
2. Collapses parameterised URLs: `/users/123` → `/users/{id}`, UUIDs → `{uuid}`
3. Groups entries by `METHOD /template`
4. Trims top 5% outliers per group, then computes p50 / p75 / p95 / p99
5. Sets threshold = `Math.round(p95 × multiplier)` per group
6. Emits a valid k6 `export const options = { thresholds: {...} }` block

---

## E2E test results

Validated against three HAR sizes:

| Dataset | Entries | Routes | Result |
|---|---|---|---|
| Small (`small.har`) | 5 | 3 | ✅ all routes resolved, correct p95 |
| Medium (`medium.har`) | 48 | 6 | ✅ all routes resolved, correct p95 |
| Large (`large.har`) | 500 | 10 | ✅ UUIDs collapsed, multiplier scales correctly |

Multiplier scaling confirmed on large dataset (`GET /api/analytics/summary`, p95=971ms):

| Multiplier | Threshold |
|---|---|
| `1.2×` | `p(95)<1165` |
| `1.5×` (default) | `p(95)<1457` |
| `2.0×` | `p(95)<1942` |

---

## Options

| Flag | Default | Description |
|---|---|---|
| `--input`, `-i` | *(required)* | Path to HAR file |
| `--multiplier`, `-m` | `1.5` | Applied to p95 to set threshold |
| `--format`, `-f` | `js` | Output format: `js` or `json` |
| `--output`, `-o` | stdout | Write to file instead of stdout |
| `--explain`, `-e` | off | Annotate with Claude Haiku rationale (needs `ANTHROPIC_API_KEY`) |

---

## Claude Code Skill

```bash
# Use the bundled Claude Code skill in your project
npx har-to-k6-thresholds  # or install the skill from .claude-plugin/
```

The skill is available via the Claude Code marketplace. It reads a HAR file path and runs the CLI, explaining each threshold.

---

## License

MIT © [aks-builds](https://github.com/aks-builds)
