// SRS traceability: every ID owned by milestones up to the current one must appear in a test name.
// Usage: node scripts/trace.ts <milestone> [repoRoot]
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const cells = (row: string) =>
  row
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

// First-column values of the table under a heading, e.g. reminder codes or MCP tool names.
function firstColumn(srs: string, heading: string): string[] {
  const section = srs.split(heading)[1].split('\n### ')[0];
  return section
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .slice(2) // header + separator
    .flatMap((row) => cells(row)[0].split(' / '));
}

function expand(token: string, srs: string): string[] {
  if (token === 'REM codes') return firstColumn(srs, '### 4.2');
  if (token === 'section 6') return firstColumn(srs, '### 6.1');
  const range = token.match(/^([A-Z]+-?)(\d+)–(?:[A-Z]+-?)?(\d+)$/);
  if (range) {
    const [, prefix, from, to] = range;
    return Array.from({ length: +to - +from + 1 }, (_, i) => `${prefix}${+from + i}`);
  }
  if (/^[A-Z]+-?\d+$/.test(token)) return [token];
  throw new Error(`Unknown SRS ID token in milestone table: ${token}`);
}

export function milestoneIds(srs: string, upTo: string): string[] {
  const rows = srs
    .split('## 9. Milestones')[1]
    .split('\n')
    .filter((line) => /^\| M\d/.test(line))
    .map(cells);
  const end = rows.findIndex((r) => r[0].startsWith(`${upTo} `));
  if (end === -1) throw new Error(`Unknown milestone ${upTo}`);
  const tokens = rows.slice(0, end + 1).flatMap((r) => r.at(-1)!.split(', '));
  return [...new Set(tokens.flatMap((t) => expand(t, srs)))];
}

export function testTitles(source: string): string[] {
  return [...source.matchAll(/\b(?:it|test|describe)\(\s*(['"`])(.*?)\1/g)].map((m) => m[2]);
}

export function missingIds(ids: string[], titles: string[]): string[] {
  return ids.filter((id) => !titles.some((t) => new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(t)));
}

if (import.meta.main) {
  const [milestone, root = '.'] = process.argv.slice(2);
  const ids = milestoneIds(readFileSync(join(root, 'docs/SRS.md'), 'utf8'), milestone);
  // ponytail: scans TS test files only; add supabase/tests/**/*.sql when pgTAP lands in M4.
  const files = globSync('**/*.{test,spec}.{ts,tsx}', {
    cwd: root,
    exclude: ['**/node_modules/**'],
  });
  const titles = files.flatMap((f) => testTitles(readFileSync(join(root, f), 'utf8')));
  const missing = missingIds(ids, titles);
  if (missing.length) {
    console.error(`${milestone}: no test names these SRS IDs: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${milestone}: all ${ids.length} SRS IDs covered by tests`);
  }
}
