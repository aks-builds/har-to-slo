#!/usr/bin/env node
// src/cli.js
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { parseHarFile } from './parser.js';
import { collapseUrl }   from './routes.js';
import { computeGroups } from './stats.js';
import { emitThresholds } from './emitter.js';

const { values: argv } = parseArgs({
  options: {
    input:      { type: 'string',  short: 'i' },
    multiplier: { type: 'string',  short: 'm', default: '1.5' },
    format:     { type: 'string',  short: 'f', default: 'js' },
    output:     { type: 'string',  short: 'o' },
    explain:    { type: 'boolean', short: 'e', default: false },
    help:       { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
  strict: false,
});

if (argv.help) {
  process.stdout.write(`
har-to-k6-thresholds — derive k6 SLO thresholds from real HAR timing data

Usage:
  har-to-k6-thresholds --input recording.har [options]

Options:
  --input,      -i  Path to HAR file (required)
  --multiplier, -m  Threshold = p95 × multiplier (default: 1.5)
  --format,     -f  Output format: js (default) or json
  --output,     -o  Write to file instead of stdout
  --explain,    -e  Annotate thresholds with Claude Haiku rationale
  --help,       -h  Show this help
`);
  process.exit(0);
}

if (!argv.input) {
  process.stderr.write('Error: --input <path-to-har> is required\n');
  process.exit(1);
}

const multiplier = parseFloat(argv.multiplier);
if (isNaN(multiplier) || multiplier <= 0) {
  process.stderr.write('Error: --multiplier must be a positive number\n');
  process.exit(1);
}

try {
  const entries = await parseHarFile(argv.input);
  const groups  = computeGroups(entries, collapseUrl);

  let result;
  if (argv.format === 'json') {
    const thresholds = {};
    for (const [key, stats] of Object.entries(groups)) {
      thresholds[key] = {
        p95_baseline: stats.p95,
        threshold_ms: Math.round(stats.p95 * multiplier),
        count: stats.count
      };
    }
    result = JSON.stringify({ thresholds }, null, 2);
  } else {
    result = emitThresholds(groups, multiplier);
  }

  if (argv.explain && process.env.ANTHROPIC_API_KEY) {
    const { annotate } = await import('./explain.js');
    result = await annotate(result, groups);
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
