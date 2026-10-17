import { beforeAll, describe, expect, it } from 'vitest';
import { connect } from './harness';

const READ_TOOLS = [
  'get_calendar',
  'get_post',
  'check_balance',
  'list_ideas',
  'list_media',
  'get_weekly_report',
  'get_checkins',
  'get_follower_history',
  'get_metrics_summary',
  'list_milestones',
  'list_triggers',
  'get_settings',
];
const WRITE_TOOLS = [
  'create_idea',
  'review_idea',
  'propose_post',
  'update_post',
  'update_variant',
  'update_milestone',
  'create_trigger',
  'resolve_trigger',
];

describe('FR-28: server contract', () => {
  let c: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    c = await connect();
  }, 30_000);

  it('FR-28: the server lists exactly the section 6.1 tools', async () => {
    const { tools } = await c.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it('FR-28: there is no delete tool', async () => {
    const { tools } = await c.client.listTools();
    expect(tools.filter((t) => /delete|remove|destroy|drop/i.test(t.name))).toEqual([]);
  });

  it('FR-28: read tools are readOnlyHint; write tools are destructiveHint false', async () => {
    const { tools } = await c.client.listTools();
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const name of READ_TOOLS) expect(hints[name], name).toMatchObject({ readOnlyHint: true });
    for (const name of WRITE_TOOLS) {
      expect(hints[name], name).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
  });

  it('FR-28: server instructions state the balance rules, the idea rubric and the feedback style', () => {
    const instructions = c.client.getInstructions() ?? '';
    for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])
      expect(instructions).toContain(rule);
    for (const criterion of ['forwardable', 'fills_gap', 'doable', 'original', 'hook']) {
      expect(instructions).toContain(criterion);
    }
    expect(instructions).toMatch(/11 or more.*go/i);
    expect(instructions).toMatch(/direct/i);
    expect(instructions).toMatch(/at least one alternative/i);
    expect(instructions).toMatch(/never delete/i);
  });
});
