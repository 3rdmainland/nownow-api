export type ImagePurpose =
    | 'landing-bg'
    | 'app-bg'
    | 'event-banner'
    | 'logo-light'
    | 'logo-dark'
    | 'favicon'
    | 'vendor-logo'
    | 'menu-item';

export interface UploadResult {
    url: string;
    purpose: ImagePurpose;
    fileName: string;
}

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/** Maps each purpose to its Supabase Storage bucket and path prefix */
export const BUCKET_MAP: Record<ImagePurpose, { bucket: string; pathPrefix: (id: string) => string }> = {
    'landing-bg':   { bucket: 'event-branding', pathPrefix: (id) => `events/${id}` },
    'app-bg':       { bucket: 'event-branding', pathPrefix: (id) => `events/${id}` },
    'event-banner': { bucket: 'event-branding', pathPrefix: (id) => `events/${id}` },
    'logo-light':   { bucket: 'event-branding', pathPrefix: (id) => `events/${id}` },
    'logo-dark':    { bucket: 'event-branding', pathPrefix: (id) => `events/${id}` },
    'favicon':      { bucket: 'event-branding', pathPrefix: (id) => `events/${id}` },
    'vendor-logo':  { bucket: 'vendor-images',  pathPrefix: (id) => `vendors/${id}` },
    'menu-item':    { bucket: 'menu-images',    pathPrefix: (id) => `vendors/${id}` },
};
