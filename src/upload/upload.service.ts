import { supabase } from '../lib/supabase.js';
import { ImagePurpose, UploadResult, ALLOWED_MIME_TYPES, MAX_FILE_SIZE, BUCKET_MAP } from './upload.types.js';
import { ValidationError } from '../lib/errors.js';

export async function uploadImage(
    buffer: Buffer,
    mimeType: string,
    resourceId: string,
    purpose: ImagePurpose,
): Promise<UploadResult> {
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
        throw new ValidationError(`Invalid file type: ${mimeType}. Allowed: JPEG, PNG, WebP`);
    }

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
        throw new ValidationError(`File too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Max: 5 MB`);
    }

    const mapping = BUCKET_MAP[purpose];
    if (!mapping) {
        throw new ValidationError(`Invalid image purpose: "${purpose}". Allowed: ${Object.keys(BUCKET_MAP).join(', ')}`);
    }
    const { bucket, pathPrefix } = mapping;
    const folder = pathPrefix(resourceId);

    // Delete existing files for this purpose (cleanup orphans)
    const { data: existing } = await supabase.storage.from(bucket).list(folder);
    if (existing?.length) {
        const stale = existing
            .filter(f => f.name.startsWith(`${purpose}-`))
            .map(f => `${folder}/${f.name}`);
        if (stale.length > 0) {
            await supabase.storage.from(bucket).remove(stale);
        }
    }

    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${purpose}-${Date.now()}.${ext}`;
    const filePath = `${folder}/${fileName}`;

    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, buffer, {
            contentType: mimeType,
            upsert: true,
        });

    if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

    return {
        url: urlData.publicUrl,
        purpose,
        fileName,
    };
}
