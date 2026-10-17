import webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Sends one notification; 'gone' means the device unsubscribed and can be forgotten. */
export type Push = (target: PushTarget, payload: PushPayload) => Promise<'sent' | 'gone'>;

/** Web Push with VAPID (FR-14), via the web-push library. */
export function webPush(publicKey: string, privateKey: string, subject: string): Push {
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return async (target, payload) => {
    try {
      await webpush.sendNotification(target, JSON.stringify(payload), { TTL: 3600 });
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw error;
    }
  };
}
