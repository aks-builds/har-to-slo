// src/parser.js
import { readFile } from 'node:fs/promises';

/**
 * Parse an in-memory HAR object into a flat array of request entries.
 * Skips entries that have no `time` field.
 * @param {object} har - parsed HAR JSON
 * @returns {{ method: string, url: string, status: number, time: number }[]}
 */
export function parseHar(har) {
  return (har?.log?.entries ?? [])
    .filter(e => typeof e.time === 'number')
    .map(e => ({
      method: e.request.method.toUpperCase(),
      url: e.request.url,
      status: e.response.status,
      time: e.time
    }));
}

/**
 * Read a HAR file from disk and return parsed entries.
 * @param {string} filePath - absolute or relative path to .har file
 */
export async function parseHarFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return parseHar(JSON.parse(raw));
}
