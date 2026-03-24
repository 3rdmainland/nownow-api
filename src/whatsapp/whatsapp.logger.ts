import { supabase } from '../lib/supabase.js';

// WhatsApp Business API pricing (South Africa, ZAR)
const COST_UTILITY_ZAR = 0.14;
const COST_MARKETING_ZAR = 0.68;

type MessageCategory = 'utility' | 'marketing';
type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export class WhatsAppLogger {
  /**
   * Log a sent WhatsApp message for cost tracking and analytics.
   * Fire-and-forget — never throws.
   */
  async logMessage(params: {
    waMessageId?: string;
    phone: string;
    templateName: string;
    category: MessageCategory;
    nudgeId?: string;
  }): Promise<string | null> {
    try {
      const cost = params.category === 'marketing' ? COST_MARKETING_ZAR : COST_UTILITY_ZAR;
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .insert({
          wa_message_id: params.waMessageId ?? null,
          phone: params.phone,
          template_name: params.templateName,
          category: params.category,
          status: 'sent' as MessageStatus,
          cost_zar: cost,
          nudge_id: params.nudgeId ?? null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) {
        console.error('WhatsApp logger: insert failed', error.message);
        return null;
      }
      return data?.id ?? null;
    } catch (err) {
      console.error('WhatsApp logger error:', (err as Error).message);
      return null;
    }
  }

  /**
   * Update message status from Meta webhook delivery callbacks.
   */
  async updateStatus(waMessageId: string, status: MessageStatus): Promise<void> {
    try {
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('wa_message_id', waMessageId);

      if (error) {
        console.error('WhatsApp logger: status update failed', error.message);
      }
    } catch (err) {
      console.error('WhatsApp logger status error:', (err as Error).message);
    }
  }

}
