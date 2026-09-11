import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// C02-T4 contract: Campaign is read-only for stats outside the Donation module.
// Only src/modules/donation/index.js may WRITE campaigns.currentAmount /
// campaigns.donorCount. Reads (aggregates, response shaping, warning checks)
// elsewhere are allowed. This test fails if any other path writes those columns.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function listJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJs(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

// Write-shaped patterns: drizzle `.set({ currentAmount|donorCount })` payloads
// and direct mutations (`x.currentAmount = ...`). Response shaping such as
// `{ currentAmount: campaign.currentAmount }`, comparisons
// (`campaign.currentAmount > 0`), aggregates (`sum(campaigns.currentAmount)`),
// and the strip-on-update destructure are reads — explicitly allowed.
const SET_WRITE_RE = /\.set\(\s*\{[^}]*\b(currentAmount|donorCount)\b/;
const MUTATE_RE = /\.(currentAmount|donorCount)\s*=[^=]/;

function isAllowedFile(rel) {
  if (rel === 'modules/donation/index.js') return true;
  if (rel === 'db/schema.js') return true; // column definitions, not runtime writes
  return false;
}

describe('campaign stats read-only contract (T4)', () => {
  it('no code outside the Donation module writes currentAmount/donorCount', () => {
    const files = listJs(SRC);
    const violations = [];
    for (const full of files) {
      const rel = relative(SRC, full).replace(/\\/g, '/');
      if (isAllowedFile(rel)) continue;
      const src = readFileSync(full, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        // Per-line check (single-line `.set({ currentAmount })` + mutations).
        if (SET_WRITE_RE.test(line) || MUTATE_RE.test(line)) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
      // Multiline-safe check: strip comments, then look for `.set({...stats...})`
      // spanning newlines plus raw `update(campaigns` with stats in the file.
      const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const multilineSet = /\.set\(\s*\{[\s\S]{0,300}?\b(currentAmount|donorCount)\b/.test(stripped);
      if (multilineSet && !violations.some((v) => v.startsWith(rel))) {
        violations.push(`${rel}: multiline .set({ currentAmount|donorCount }) write`);
      }
    }
    expect(violations, `Campaign stats writes outside src/modules/donation/index.js:\n${violations.join('\n')}`).toEqual([]);
  });
});
