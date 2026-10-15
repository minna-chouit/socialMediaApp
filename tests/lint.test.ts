import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function lint(code: string, filePath = 'packages/core/src/example.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

describe('NFR-8: no system time in core', () => {
  // First lint loads the TypeScript parser; slow when other test files run in parallel.
  beforeAll(() => lint(''), 30_000);

  it('NFR-8: lint flags new Date() in core', async () => {
    const [msg] = await lint('export const t = new Date();');
    expect(msg?.message).toMatch(/Clock/);
  });

  it('NFR-8: lint flags Date.now() in core', async () => {
    const [msg] = await lint('export const t = Date.now();');
    expect(msg?.message).toMatch(/Clock/);
  });

  it('NFR-8: lint flags bare Date() call in core', async () => {
    const [msg] = await lint('export const t = Date();');
    expect(msg?.message).toMatch(/Clock/);
  });

  it('NFR-8: lint allows clock.now() via an injected Clock', async () => {
    const code = 'export const at = (clock: { now(): number }) => clock.now();';
    expect(await lint(code)).toEqual([]);
  });

  it('NFR-8: the rule does not apply outside packages/core', async () => {
    expect(await lint('export const t = new Date();', 'apps/web/src/example.ts')).toEqual([]);
  });
});
