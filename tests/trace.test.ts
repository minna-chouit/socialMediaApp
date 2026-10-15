import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { milestoneIds, missingIds, testTitles } from '../scripts/trace';

const root = fileURLToPath(new URL('..', import.meta.url));
const srs = readFileSync(join(root, 'docs/SRS.md'), 'utf8');

// Builds test source text without writing a literal `it('...')` here, which the trace scanner would read.
const call = (fn: string, title: string) => `${fn}('${title}', () => {});`;

function runTrace(testSource: string) {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-trace-'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/SRS.md'), srs);
  writeFileSync(join(dir, 'a.test.ts'), testSource);
  return spawnSync(process.execPath, [join(root, 'scripts/trace.ts'), 'M0', dir], {
    encoding: 'utf8',
  });
}

describe('NFR-10: SRS traceability', () => {
  it('NFR-10: trace parses milestone IDs, expanding ranges', () => {
    const ids = milestoneIds(srs, 'M8');
    for (const id of ['R1', 'R5', 'R8', 'T1', 'T3', 'FR-17', 'FR-19', 'FR-22']) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain('T4');
  });

  it('NFR-10: trace fails and lists an SRS ID that has no test', () => {
    const run = runTrace(call('it', 'NFR-8: covered'));
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).toContain('NFR-10');
  });

  it('NFR-10: trace passes when every ID is in a test name', () => {
    const run = runTrace(call('it', 'NFR-8: a') + call('test', 'NFR-10: b'));
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('NFR-10: trace only checks milestones up to the current one', () => {
    expect(milestoneIds(srs, 'M0')).toEqual(['NFR-8', 'NFR-10']);
    expect(milestoneIds(srs, 'M1')).toEqual(['NFR-8', 'NFR-10', 'FR-2', 'FR-4', 'FR-10']);
    expect(() => milestoneIds(srs, 'M9')).toThrow(/M9/);
  });

  it('NFR-10: trace matches whole IDs only', () => {
    const titles = testTitles(call('it', 'FR-10: x') + call('describe', 'R12 group'));
    expect(missingIds(['FR-1', 'FR-10', 'R1'], titles)).toEqual(['FR-1', 'R1']);
  });

  it('NFR-10: trace handles REM codes and section 6 tool names', () => {
    const m3 = milestoneIds(srs, 'M3');
    for (const code of ['SHOT_LIST', 'REPLY_START', 'REPLY_END', 'TRIGGER']) {
      expect(m3).toContain(code);
    }
    const m5 = milestoneIds(srs, 'M5');
    for (const tool of ['get_calendar', 'list_milestones', 'list_triggers', 'resolve_trigger']) {
      expect(m5).toContain(tool);
    }
  });
});
