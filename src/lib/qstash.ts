import { Client } from '@upstash/qstash';

const hasQStash = !!process.env.QSTASH_TOKEN;

export const qstash = hasQStash
  ? new Client({ token: process.env.QSTASH_TOKEN! })
  : null;

/**
 * Get the base URL for QStash callbacks.
 * In production: your Railway public URL.
 * In dev: not available (QStash needs a public URL).
 */
export function getCallbackBaseUrl(): string | null {
  // Explicit override
  if (process.env.QSTASH_CALLBACK_URL) return process.env.QSTASH_CALLBACK_URL;
  // Railway gives you a public URL
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  // Fallback for known prod URL
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL;
  return null;
}
