// src/sources/logs.js
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { collapseUrl } from '../routes.js';
import { computeGroups } from '../stats.js';

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
    if (duration < 10) duration = duration * 1000;
    return { method: method.toUpperCase(), path, status, time: Math.round(duration) };
  } catch { return null; }
}

function detectFormat(firstLine) {
  if (!firstLine) return 'nginx';
  if (firstLine.startsWith('{')) return 'ndjson';
  if (/^(https? |h2 |grpc |ws )/.test(firstLine)) return 'alb';
  return 'nginx';
}

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
  const parsers = { nginx: parseNginxLine, alb: parseAlbLine, ndjson: parseNdjsonLine };
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (fmt === null) fmt = detectFormat(trimmed);
    const entry = parsers[fmt](trimmed);
    if (!entry) continue;
    const fakeUrl = `https://host${entry.path}`;
    entries.push({ method: entry.method, url: fakeUrl, status: entry.status, time: entry.time });
  }

  const groups = computeGroups(entries, collapseUrl);
  return Object.entries(groups).map(([key, stats]) => {
    const spaceIdx = key.indexOf(' ');
    const method   = key.slice(0, spaceIdx);
    const template = key.slice(spaceIdx + 1);
    return { key, method, template, ...stats };
  });
}
