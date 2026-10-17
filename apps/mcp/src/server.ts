import { ideaReviewInput, PILLARS, PLATFORMS, FORMATS, TOPICS, type Clock } from '@cadence/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Db } from './db';
import { enforceWriteLimit, HANDLERS, ToolError, type Context } from './handlers';

export interface ServerDeps {
  db: Db;
  ownerId: string;
  clock: Clock;
  /** A short-lived signed URL for a media bank file (Supabase Storage in production). */
  signUrl: (storagePath: string) => Promise<string | null>;
}

// Section 6.2 rule 6: what Claude needs to know to use the tools well.
export const INSTRUCTIONS = `Cadence runs one person's social media plan. You can read everything and create or update
ideas, posts, milestones and triggers. You can never delete anything, and you cannot change a post's
stage: posts you propose start as proposed and only the owner approves them. Every write needs a short
reason, which is shown to the owner in the change log.

Balance rules (check_balance returns warnings by rule):
R1 personal pillar mix over 28 days matches the phase targets (Phase 1: life_style 5, student_life 2,
   pov_journey 1; Phase 2: 7, 3, 2); work_lessons stays off Instagram and TikTok unless allowed.
R2 never the same pillar twice in a row on one platform.
R3 every topic gets a LinkedIn post within 42 days; accessibility within 28 days.
R4 every platform posts every planning week (Saturday to Friday).
R5 LinkedIn only takes work_lessons or pov_journey.
R6 Instagram each week: at least 1 reel and 1 carousel, and at least 2 posts (Phase 2: 3).
R7 Instagram and TikTok versions are paired.
R8 at most one leftovers post per week.

Idea rubric (review_idea): score forwardable, fills_gap, doable, original and hook from 1 to 3.
Cadence computes the verdict: 11 or more is go, 8 to 10 is improve (say what to fix), under 8 is bank.

Feedback style: be direct, and always give at least one alternative.`;

// Any 8-4-4-4-12 hex id; Postgres does not require an RFC 4122 version digit.
const id = z.guid();
const date = z.iso.date();
const dateTime = z.iso.datetime({ offset: true });
const reason = z
  .string()
  .trim()
  .min(1)
  .describe('Why you are making this change; shown to the owner');
const variantInput = z.object({
  platform: z.enum(PLATFORMS),
  format: z.enum(FORMATS),
  language: z.enum(['en', 'darija', 'mixed']).optional(),
  caption: z.string().optional(),
  hook: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  scheduledAt: dateTime.optional(),
});
const postInput = z.object({
  title: z.string().trim().min(1),
  pillar: z.enum(PILLARS),
  topics: z.array(z.enum(TOPICS)),
  goLiveAt: dateTime,
  variants: z.array(variantInput).min(1),
  ideaId: id.optional(),
  isLeftovers: z.boolean().optional(),
  notes: z.string().optional(),
});

/** Section 6.1. `read` tools never write. */
const TOOLS: { name: string; read: boolean; description: string; input: z.ZodRawShape }[] = [
  {
    name: 'get_calendar',
    read: true,
    description: 'Variants going live between two dates, with post summary, stage and local times.',
    input: { from: date, to: date },
  },
  {
    name: 'get_post',
    read: true,
    description: 'One post with its variants, linked media and change log.',
    input: { id },
  },
  {
    name: 'check_balance',
    read: true,
    description:
      'Balance warnings (rules R1–R8) for a date range, optionally with a hypothetical post.',
    input: { from: date, to: date, hypothetical: postInput.optional() },
  },
  {
    name: 'list_ideas',
    read: true,
    description: 'Ideas with their latest verdict.',
    input: {
      status: z.enum(['new', 'reviewed', 'promoted', 'banked']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  {
    name: 'list_media',
    read: true,
    description: 'Media bank items with short-lived signed thumbnail URLs.',
    input: {
      tags: z.array(z.string()).optional(),
      unusedOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  {
    name: 'get_weekly_report',
    read: true,
    description: 'A weekly report; defaults to the latest one the owner marked ready for Claude.',
    input: { weekStart: date.optional() },
  },
  {
    name: 'get_checkins',
    read: true,
    description: 'Check-ins with their metrics between two dates. Missing metrics are null.',
    input: { from: date, to: date },
  },
  {
    name: 'get_follower_history',
    read: true,
    description: 'Weekly follower counts.',
    input: {
      platform: z.enum(PLATFORMS).optional(),
      weeks: z.number().int().min(1).max(104).optional(),
    },
  },
  {
    name: 'get_metrics_summary',
    read: true,
    description: 'Totals and means per platform and pillar for one month.',
    input: { month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM') },
  },
  {
    name: 'list_milestones',
    read: true,
    description: 'Milestones and their outcomes.',
    input: { unresolvedOnly: z.boolean().optional() },
  },
  {
    name: 'list_triggers',
    read: true,
    description: 'Strategy review triggers.',
    input: { unresolvedOnly: z.boolean().optional() },
  },
  { name: 'get_settings', read: true, description: 'The owner’s settings (read-only).', input: {} },
  {
    name: 'create_idea',
    read: false,
    description: 'Add an idea to the idea pool (source chat).',
    input: {
      text: z.string().trim().min(1),
      pillar: z.enum(PILLARS).optional(),
      topics: z.array(z.enum(TOPICS)).optional(),
      tags: z.array(z.string()).optional(),
      reason,
    },
  },
  {
    name: 'review_idea',
    read: false,
    description: 'Store your rubric scores for an idea; Cadence computes the verdict.',
    input: { ideaId: id, ...ideaReviewInput.shape },
  },
  {
    name: 'propose_post',
    read: false,
    description:
      'Propose a post. It is saved as proposed for the owner to approve, and returns balance warnings.',
    input: { ...postInput.shape, reason },
  },
  {
    name: 'update_post',
    read: false,
    description: 'Change post fields (not its stage).',
    input: { id, patch: postInput.omit({ variants: true }).partial().strict(), reason },
  },
  {
    name: 'update_variant',
    read: false,
    description: 'Change variant fields (not postedAt).',
    input: { id, patch: variantInput.partial().strict(), reason },
  },
  {
    name: 'update_milestone',
    read: false,
    description: 'Record a milestone outcome and decision.',
    input: { id, outcome: z.string().trim().min(1), decision: z.string().trim().min(1), reason },
  },
  {
    name: 'create_trigger',
    read: false,
    description: 'Flag a platform policy or algorithm change (T4) for an early strategy review.',
    input: {
      rule: z.literal('T4'),
      platform: z.enum(PLATFORMS),
      note: z.string().trim().min(1),
      reason,
    },
  },
  {
    name: 'resolve_trigger',
    read: false,
    description: 'Resolve a strategy trigger with a note.',
    input: { id, note: z.string().trim().min(1), reason },
  },
];

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'cadence', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of TOOLS) {
    const handler = HANDLERS[tool.name];
    if (!handler) throw new Error(`No handler for tool ${tool.name}`);
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.read
          ? { readOnlyHint: true }
          : { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async (args: Record<string, unknown>) => {
        const reason = typeof args.reason === 'string' ? args.reason : null;
        try {
          return ok(
            await deps.db(deps.ownerId, reason, async (tx) => {
              const [settings] = await tx.query<Context['settings']>(
                'select * from public.settings',
              );
              if (!tool.read) await enforceWriteLimit(tx);
              return handler(args, { tx, settings, deps });
            }),
          );
        } catch (error) {
          if (error instanceof ToolError) return fail(error.message);
          throw error;
        }
      },
    );
  }
  return server;
}
