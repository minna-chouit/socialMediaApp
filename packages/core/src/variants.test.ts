import { describe, expect, it } from 'vitest';
import { checkVariants, FORMATS, isFormatAllowed, PLATFORMS } from './variants';

// FR-4 acceptance criteria, written out by hand.
const ALLOWED = [
  ['instagram', 'reel'],
  ['instagram', 'carousel'],
  ['instagram', 'photo'],
  ['instagram', 'story'],
  ['tiktok', 'video'],
  ['tiktok', 'photo'],
  ['linkedin', 'text'],
  ['linkedin', 'image'],
  ['linkedin', 'document'],
  ['linkedin', 'video'],
] as const;

const allowed = (p: string, f: string) => ALLOWED.some(([ap, af]) => ap === p && af === f);

describe('FR-4: platform formats', () => {
  it('FR-4: allows the 10 listed platform/format pairs', () => {
    for (const [platform, format] of ALLOWED) {
      expect(isFormatAllowed(platform, format), `${platform} ${format}`).toBe(true);
      expect(checkVariants([{ platform, format }])).toEqual([]);
    }
  });

  it('FR-4: rejects every other pair, including LinkedIn reel', () => {
    const others = PLATFORMS.flatMap((p) => FORMATS.map((f) => [p, f] as const)).filter(
      ([p, f]) => !allowed(p, f),
    );
    expect(others).toHaveLength(14);
    for (const [platform, format] of others) {
      expect(isFormatAllowed(platform, format), `${platform} ${format}`).toBe(false);
    }
    expect(checkVariants([{ platform: 'linkedin', format: 'reel' }])).toEqual([
      'linkedin does not support the reel format',
    ]);
  });

  it('FR-4: rejects a post with two variants on the same platform', () => {
    const errors = checkVariants([
      { platform: 'instagram', format: 'reel' },
      { platform: 'tiktok', format: 'video' },
      { platform: 'instagram', format: 'photo' },
    ]);
    expect(errors).toEqual(['a post can have only one instagram variant']);
  });
});
