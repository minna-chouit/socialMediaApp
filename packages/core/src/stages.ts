export const STAGES = [
  'idea',
  'proposed',
  'approved',
  'capture',
  'edit',
  'write',
  'scheduled',
  'posted',
  'replied',
  'reviewed',
  'archived',
] as const;

export type Stage = (typeof STAGES)[number];

/** Forward one step, back to any earlier stage, archive from anywhere, restore archived to idea. */
export function canMove(from: Stage, to: Stage): boolean {
  if (from === 'archived') return to === 'idea';
  if (to === 'archived') return true;
  const step = STAGES.indexOf(to) - STAGES.indexOf(from);
  return step === 1 || step < 0;
}
