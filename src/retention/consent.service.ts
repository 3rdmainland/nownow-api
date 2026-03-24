import { supabase } from '../lib/supabase.js';
import type { ConsentType } from './retention.types.js';

export class ConsentService {
  /**
   * Grant WhatsApp consent (upsert — re-granting after revoke is allowed).
   */
  async grantConsent(
    customerId: string,
    phone: string,
    eventId: string,
    consentType: ConsentType,
  ): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_consents')
      .upsert(
        {
          customer_id: customerId,
          phone,
          event_id: eventId,
          consent_type: consentType,
          granted: true,
          granted_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'customer_id,event_id,consent_type' },
      );

    if (error) {
      console.error('ConsentService.grantConsent failed:', error.message);
      throw new Error(`Failed to grant consent: ${error.message}`);
    }
  }

  /**
   * Revoke consent — sets granted=false and records revoked_at.
   */
  async revokeConsent(
    customerId: string,
    eventId: string,
    consentType: ConsentType,
  ): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_consents')
      .update({
        granted: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('customer_id', customerId)
      .eq('event_id', eventId)
      .eq('consent_type', consentType);

    if (error) {
      console.error('ConsentService.revokeConsent failed:', error.message);
      throw new Error(`Failed to revoke consent: ${error.message}`);
    }
  }

  /**
   * Check if a customer has active consent for a given event + type.
   */
  async hasConsent(
    customerId: string,
    eventId: string,
    consentType: ConsentType,
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from('whatsapp_consents')
      .select('granted')
      .eq('customer_id', customerId)
      .eq('event_id', eventId)
      .eq('consent_type', consentType)
      .maybeSingle();

    if (error) {
      console.error('ConsentService.hasConsent failed:', error.message);
      return false;
    }

    return data?.granted === true;
  }

  /**
   * Get full consent status for a customer at a specific event.
   */
  async getConsentStatus(
    customerId: string,
    eventId: string,
  ): Promise<{ marketing: boolean; transactional: boolean }> {
    const { data, error } = await supabase
      .from('whatsapp_consents')
      .select('consent_type, granted')
      .eq('customer_id', customerId)
      .eq('event_id', eventId);

    if (error) {
      console.error('ConsentService.getConsentStatus failed:', error.message);
      return { marketing: false, transactional: false };
    }

    const result = { marketing: false, transactional: false };
    for (const row of data ?? []) {
      if (row.consent_type === 'marketing') result.marketing = row.granted === true;
      if (row.consent_type === 'transactional') result.transactional = row.granted === true;
    }
    return result;
  }
}
