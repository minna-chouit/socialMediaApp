export const PLATFORMS = ['instagram', 'tiktok', 'linkedin'] as const;
export const FORMATS = [
  'reel',
  'carousel',
  'photo',
  'story',
  'video',
  'text',
  'image',
  'document',
] as const;

export type Platform = (typeof PLATFORMS)[number];
export type Format = (typeof FORMATS)[number];

const ALLOWED_FORMATS: Record<Platform, readonly Format[]> = {
  instagram: ['reel', 'carousel', 'photo', 'story'],
  tiktok: ['video', 'photo'],
  linkedin: ['text', 'image', 'document', 'video'],
};

export function isFormatAllowed(platform: Platform, format: Format): boolean {
  return ALLOWED_FORMATS[platform].includes(format);
}

/** Human-readable problems with a post's variants; empty when valid (FR-4). */
export function checkVariants(variants: { platform: Platform; format: Format }[]): string[] {
  const badFormats = variants
    .filter((v) => !isFormatAllowed(v.platform, v.format))
    .map((v) => `${v.platform} does not support the ${v.format} format`);
  const duplicates = PLATFORMS.filter(
    (p) => variants.filter((v) => v.platform === p).length > 1,
  ).map((p) => `a post can have only one ${p} variant`);
  return [...badFormats, ...duplicates];
}

/** Why a post's variant cannot be removed, or null when it can (FR-29). `variants` are the live ones. */
export function removalProblem(variants: { id: string; postedAt?: unknown }[], id: string) {
  if (variants.find((v) => v.id === id)?.postedAt) {
    return 'This variant is already posted, so it stays';
  }
  if (variants.length <= 1) {
    return 'This is the post’s only variant; withdraw or archive the post instead';
  }
  return null;
}
