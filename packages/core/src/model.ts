import type { Temporal } from 'temporal-polyfill';
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
}

export interface Settings {
  timeZone: string;
  phase: 1 | 2;
  workOnPersonal: boolean;
  replyWindowMinutes: number;
  checkinOffsets: Record<Platform, number[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  timeZone: 'Africa/Algiers',
  phase: 1,
  workOnPersonal: false,
  replyWindowMinutes: 15,
  checkinOffsets: { instagram: [3, 7], tiktok: [3, 7, 14], linkedin: [3, 7] },
};
