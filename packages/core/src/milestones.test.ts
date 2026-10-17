import { describe, expect, it } from 'vitest';
import { at } from '../test/fixtures';
import { seedMilestones } from './milestones';
import { DEFAULT_SETTINGS as S } from './model';

const FIRST_POST = at('2026-10-21T11:00:00Z'); // Wednesday; week 1 runs Sat 17 – Fri 23 Oct
const due = (firstPostAt = FIRST_POST) =>
  seedMilestones(firstPostAt, S).map((m) => [m.kind, m.week, m.dueAt.toString()]);

describe('FR-21: milestone seeding', () => {
  it('FR-21: checkpoints for weeks 1, 2, 4, 6 and 10, due on the Friday of that week', () => {
    expect(due().filter(([kind]) => kind === 'checkpoint')).toEqual([
      ['checkpoint', 1, '2026-10-23T19:00:00Z'],
      ['checkpoint', 2, '2026-10-30T19:00:00Z'],
      ['checkpoint', 4, '2026-11-13T19:00:00Z'],
      ['checkpoint', 6, '2026-11-27T19:00:00Z'],
      ['checkpoint', 10, '2026-12-25T19:00:00Z'],
    ]);
  });

  it('FR-21: research refresh every 13 weeks', () => {
    expect(due().filter(([kind]) => kind === 'research_refresh')).toEqual([
      ['research_refresh', 13, '2027-01-15T19:00:00Z'],
      ['research_refresh', 26, '2027-04-16T19:00:00Z'],
      ['research_refresh', 39, '2027-07-16T19:00:00Z'],
      ['research_refresh', 52, '2027-10-15T19:00:00Z'],
    ]);
  });

  it('FR-21: titles and checks come from the strategy table; outcome and decision start empty', () => {
    const [week1, week2, week4, week6, week10, refresh] = seedMilestones(FIRST_POST, S);
    expect(week1).toMatchObject({
      id: 'checkpoint:1',
      title: 'Setup',
      checks: ['Creator accounts', 'App on the Home Screen', 'Baseline follower counts'],
      outcome: null,
      decision: null,
    });
    expect([week2, week4, week6, week10, refresh].map((m) => m.title)).toEqual([
      'First posts out',
      'Phase 1 complete',
      'Topic coverage',
      'Habit checkpoint',
      'Research refresh',
    ]);
    expect(week4.checks).toContain('Compare English vs Darija');
    expect(refresh).toMatchObject({ id: 'research_refresh:13', checks: ['Update rules'] });
  });

  it('FR-21: a first post on a Saturday starts week 1 that day', () => {
    expect(due(at('2026-10-23T23:30:00Z'))[0]).toEqual(['checkpoint', 1, '2026-10-30T19:00:00Z']); // Sat 00:30
    expect(due(at('2026-10-23T22:59:00Z'))[0]).toEqual(['checkpoint', 1, '2026-10-23T19:00:00Z']); // Fri 23:59
  });
});
