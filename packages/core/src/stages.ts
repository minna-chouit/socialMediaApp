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

/** Approved or later and not archived: the stages that count as planned (FR-8, FR-17). */
export const isApprovedOrLater = (stage: Stage) =>
  STAGES.indexOf(stage) >= STAGES.indexOf('approved') && stage !== 'archived';
