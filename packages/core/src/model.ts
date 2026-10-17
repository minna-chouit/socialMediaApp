import type { Temporal } from 'temporal-polyfill';
import type { ReminderCode } from './reminders';
import type { Stage } from './stages';
import type { Format, Platform } from './variants';

export const PILLARS = ['life_style', 'student_life', 'pov_journey', 'work_lessons'] as const;
export const TOPICS = ['ai', 'uiux', 'gamedev', 'ar', 'accessibility'] as const;

export type Pillar = (typeof PILLARS)[number];
export type Topic = (typeof TOPICS)[number];

export interface Variant {
  id: string;
  platform: Platform;
  format: Format;
  scheduledAt?: Temporal.Instant;
  /** Scheduled in the platform's own scheduler. */
  scheduledNatively?: boolean;
  postedAt?: Temporal.Instant;
}

export interface Post {
  id: string;
  title: string;
  pillar: Pillar;
  topics: Topic[];
  status: Stage;
  goLiveAt: Temporal.Instant;
  isLeftovers: boolean;
  variants: Variant[];
  /** Per-post overrides of the reminder defaults (FR-13). */
  reminders?: { off?: ReminderCode[]; replyWindowMinutes?: number };
}

export interface Settings {
  timeZone: string;
  phase: 1 | 2;
  workOnPersonal: boolean;
  replyWindowMinutes: number;
  checkinOffsets: Record<Platform, number[]>;
  /** Local times as HH:MM. */
  reportTime: string;
  batchTime: string;
  quietStart: string;
  quietEnd: string;
  replyRemindersTikTok: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timeZone: 'Africa/Algiers',
  phase: 1,
  workOnPersonal: false,
  replyWindowMinutes: 15,
  checkinOffsets: { instagram: [3, 7], tiktok: [3, 7, 14], linkedin: [3, 7] },
  reportTime: '20:00',
  batchTime: '20:15',
  quietStart: '23:30',
  quietEnd: '08:00',
  replyRemindersTikTok: false,
};

/** When a variant goes live: its own schedule, else the post's go-live time. */
export const goesLiveAt = (post: Post, variant: Variant) => variant.scheduledAt ?? post.goLiveAt;
