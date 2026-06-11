// src/explain.js
import Anthropic from '@anthropic-ai/sdk';

/**
 * Annotate k6 threshold output with plain-English rationale from Claude Haiku.
 * @param {string} thresholdOutput - the JS string from emitThresholds
 * @param {Record<string, object>} groups - from computeGroups
 * @returns {Promise<string>}
 */
export async function annotate(thresholdOutput, groups) {
  const client = new Anthropic();
  const groupSummary = Object.entries(groups)
    .map(([key, s]) => `${key}: p95=${s.p95}ms, count=${s.count}`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a performance engineering assistant. Below are k6 thresholds derived from real HAR file timing data. Add a one-line JS comment above each threshold explaining why this SLO value makes sense given the baseline data. Keep comments under 100 chars each. Return ONLY the modified JS with your comments inserted — no prose, no markdown.

Route baselines:
${groupSummary}

Current thresholds output:
${thresholdOutput}`
    }]
  });

  return message.content[0].type === 'text' ? message.content[0].text : thresholdOutput;
}
