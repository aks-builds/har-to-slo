// src/stats.js

/**
 * Compute the p-th percentile of a pre-sorted array.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Group HAR entries by method+template, trim top 5% outliers, compute stats.
 */
export function computeGroups(entries, collapser) {
  const buckets = {};

  for (const entry of entries) {
    const template = collapser(entry.url);
    const key = `${entry.method} ${template}`;
    (buckets[key] ??= []).push(entry.time);
  }

  const groups = {};
  for (const [key, times] of Object.entries(buckets)) {
    const sorted = [...times].sort((a, b) => a - b);
    // Trim top 5% outliers for min/max display only
    const trimTo = Math.max(1, Math.floor(sorted.length * 0.95));
    const trimmed = sorted.slice(0, trimTo);

    groups[key] = {
      count: times.length,
      min:   trimmed[0],
      max:   trimmed[trimmed.length - 1],
      p50:   percentile(sorted, 50),   // percentiles on FULL data
      p75:   percentile(sorted, 75),
      p95:   percentile(sorted, 95),
      p99:   percentile(sorted, 99),
    };
  }
  return groups;
}
