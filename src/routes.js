// src/routes.js

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE  = /(\/)[0-9a-f]{16,}(?=\/|$)/gi;
const NUM_RE  = /\/\d+(?=\/|$)/g;

/**
 * Collapse a full URL into a normalised route template.
 * Returns only the path portion with parameterised segments replaced.
 * @param {string} url
 * @returns {string} e.g. '/users/{id}/orders/{uuid}'
 */
export function collapseUrl(url) {
  const { pathname } = new URL(url);
  return pathname
    .replace(UUID_RE, '{uuid}')
    .replace(HEX_RE,  '/{hash}')
    .replace(NUM_RE,  '/{id}');
}
