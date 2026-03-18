/**
 * SMS Provider interface.
 * Production: swap ConsoleSmsProvider for a Twilio/Sent.dm/WhatsApp implementation.
 */
export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

/**
 * Development/preprod provider — logs OTP to server console.
 * The OTP is also returned in the API response when NODE_ENV !== 'production'.
 */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    console.log(`[OTP] Phone: ${phone} | Code: ${code}`);
  }
}
