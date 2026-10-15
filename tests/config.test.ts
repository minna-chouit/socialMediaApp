import { spawnSync } from 'node:child_process';
import { globSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import config from '../vitest.config';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('NFR-10: maintainability gates', () => {
  it('NFR-10: core vitest config enforces ≥90% lines and branches', () => {
    const coverage = config.test?.coverage;
    expect(coverage?.include).toEqual(['packages/core/src/**']);
    expect(coverage && 'thresholds' in coverage && coverage.thresholds).toMatchObject({
      lines: 90,
      branches: 90,
    });
  });

  it('NFR-10: every tsconfig in the repo compiles with strict: true', () => {
    const files = globSync('**/tsconfig.json', { cwd: root, exclude: ['**/node_modules/**'] });
    expect(files).toContain('tsconfig.json');
    for (const file of files) {
      const parsed = ts.getParsedCommandLineOfConfigFile(
        join(root, file),
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: (d) => {
            throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
          },
        },
      );
      expect(parsed?.options.strict, file).toBe(true);
    }
  });

  it('NFR-10: coverage run fails on a fixture with uncovered branches', () => {
    const run = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        'tests/fixtures/uncovered',
        '--coverage.enabled',
        '--coverage.include=tests/fixtures/uncovered/sign.ts',
        `--coverage.reportsDirectory=${mkdtempSync(join(tmpdir(), 'cadence-cov-'))}`,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(run.stdout + run.stderr).toMatch(/does not meet.*threshold/i);
    expect(run.status).not.toBe(0);
  }, 60_000);
});
