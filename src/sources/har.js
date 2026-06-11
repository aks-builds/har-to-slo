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
  const groups = computeGroups(entries, collapseUrl);
  return Object.entries(groups).map(([key, stats]) => {
    const spaceIdx = key.indexOf(' ');
    const method   = key.slice(0, spaceIdx);
    const template = key.slice(spaceIdx + 1);
    return { key, method, template, ...stats };
  });
}
