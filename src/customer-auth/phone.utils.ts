/**
 * Normalize a phone number to digits-only format.
 * Matches the frontend's sanitizePhone: strips all non-digit characters.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, '');
}
