# Changelog

## [Unreleased]

## [0.1.0] - 2026-06-12

### Added
- `--source k6` — derive SLO thresholds from k6 `--summary-export` JSON output
- `--source logs` — derive thresholds from nginx, Apache, ALB, or NDJSON access logs
- `--source otel` — derive thresholds from OpenTelemetry trace JSONL exports
- `--source prometheus` — derive thresholds from live Prometheus/Mimir HTTP API
- `--url`, `--query`, `--range`, `--step`, `--prom-header` flags for Prometheus source
- Backward compatible: `har-to-slo --input recording.har` unchanged (`--source har` is default)

## [0.0.3] - 2026-06-11

## [0.0.2] - 2026-06-11

### Added
- Initial release
