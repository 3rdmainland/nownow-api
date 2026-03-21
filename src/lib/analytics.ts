import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

function getPostHog(): PostHog | null {
  if (posthogClient) return posthogClient;
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;
  posthogClient = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  });
  return posthogClient;
}

export function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
) {
  const ph = getPostHog();
  if (!ph) return;
  ph.capture({ distinctId, event, properties });
}
