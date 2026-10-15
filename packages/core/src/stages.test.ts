import { describe, expect, it } from 'vitest';
import { canMove, STAGES, type Stage } from './stages';

// Allowed targets per stage, written out by hand (not derived) so the table checks the code.
const ALLOWED: Record<Stage, Stage[]> = {
  idea: ['proposed', 'archived'],
  proposed: ['idea', 'approved', 'archived'],
  approved: ['idea', 'proposed', 'capture', 'archived'],
  capture: ['idea', 'proposed', 'approved', 'edit', 'archived'],
  edit: ['idea', 'proposed', 'approved', 'capture', 'write', 'archived'],
  write: ['idea', 'proposed', 'approved', 'capture', 'edit', 'scheduled', 'archived'],
  scheduled: ['idea', 'proposed', 'approved', 'capture', 'edit', 'write', 'posted', 'archived'],
  posted: [
    'idea',
    'proposed',
    'approved',
    'capture',
    'edit',
    'write',
    'scheduled',
    'replied',
    'archived',
  ],
  replied: [
    'idea',
    'proposed',
    'approved',
    'capture',
    'edit',
    'write',
    'scheduled',
    'posted',
    'reviewed',
    'archived',
  ],
  reviewed: [
    'idea',
    'proposed',
    'approved',
    'capture',
    'edit',
    'write',
    'scheduled',
    'posted',
    'replied',
    'archived',
  ],
  archived: ['idea'],
};

describe('FR-2: stage machine', () => {
  it('FR-2: every (from, to) pair matches the transition table', () => {
    expect(STAGES).toHaveLength(11);
    for (const from of STAGES) {
      for (const to of STAGES) {
        expect(canMove(from, to), `${from} → ${to}`).toBe(ALLOWED[from].includes(to));
      }
    }
  });

  it('FR-2: rejects capture → posted', () => {
    expect(canMove('capture', 'posted')).toBe(false);
  });

  it('FR-2: allows posted → edit', () => {
    expect(canMove('posted', 'edit')).toBe(true);
  });

  it('FR-2: allows archive from every stage', () => {
    for (const from of STAGES.filter((s) => s !== 'archived')) {
      expect(canMove(from, 'archived'), from).toBe(true);
    }
  });

  it('FR-2: rejects a move to the same stage', () => {
    for (const stage of STAGES) expect(canMove(stage, stage), stage).toBe(false);
  });

  it('FR-2: archived can only be restored to idea', () => {
    expect(STAGES.filter((to) => canMove('archived', to))).toEqual(['idea']);
  });
});
