import { expect, it } from 'vitest';
import { sign } from './sign';

// Fixture for the NFR-10 coverage gate test: deliberately covers one branch only.
it('fixture: covers the negative branch only', () => {
  expect(sign(-1)).toBe('negative');
});
