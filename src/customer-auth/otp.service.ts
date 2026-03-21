import crypto from 'node:crypto';
import { redis } from '../lib/redis.js';
import { TooManyRequestsError, UnauthorizedError } from '../lib/errors.js';
import type { OtpData } from './customer-auth.types.js';

// ── Redis key prefixes ────────────────────────────────────────────────────────
const OTP_KEY = (phone: string) => `otp:${phone}`;
const OTP_COOLDOWN_KEY = (phone: string) => `otp:cooldown:${phone}`;
const OTP_HOURLY_KEY = (phone: string) => `otp:hourly:${phone}`;

// ── Configuration ─────────────────────────────────────────────────────────────
const OTP_TTL = 300;           // 5 minutes
const OTP_COOLDOWN = 60;       // 60 seconds between sends
const MAX_ATTEMPTS = 5;        // Max verification attempts per OTP
const MAX_OTPS_PER_HOUR = 50;   // Max OTPs per phone per hour
const OTP_LENGTH = 6;

export class OtpService {
  /**
   * Generate and store a cryptographic 6-digit OTP.
   * Enforces cooldown and hourly rate limits.
   */
  async generateOtp(phone: string): Promise<string> {
    // 1. Check cooldown (60s between sends)
    const cooldownExists = await redis.exists(OTP_COOLDOWN_KEY(phone));
    if (cooldownExists) {
      throw new TooManyRequestsError('Please wait before requesting another code');
    }

    // 2. Check hourly rate limit (max 5 per hour)
    const hourlyCount = await redis.get<number>(OTP_HOURLY_KEY(phone));
    if (hourlyCount !== null && hourlyCount >= MAX_OTPS_PER_HOUR) {
      throw new TooManyRequestsError('Too many verification attempts. Please try again later');
    }

    // 3. Generate 6-digit OTP using crypto.randomInt (not Math.random)
    const code = crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');

    // 4. Store OTP in Redis with TTL
    const otpData: OtpData = { code, attempts: 0 };
    await redis.set(OTP_KEY(phone), JSON.stringify(otpData));
    await redis.expire(OTP_KEY(phone), OTP_TTL);

    // 5. Set cooldown
    await redis.set(OTP_COOLDOWN_KEY(phone), '1');
    await redis.expire(OTP_COOLDOWN_KEY(phone), OTP_COOLDOWN);

    // 6. Increment hourly counter
    const newCount = await redis.incr(OTP_HOURLY_KEY(phone));
    if (newCount === 1) {
      await redis.expire(OTP_HOURLY_KEY(phone), 3600); // 1 hour TTL
    }

    return code;
  }

  /**
   * Verify an OTP code. Enforces max attempts and single-use.
   * Returns true on success, throws on failure.
   */
  async verifyOtp(phone: string, code: string): Promise<boolean> {
    const raw = await redis.get<string>(OTP_KEY(phone));
    if (!raw) {
      throw new UnauthorizedError('Invalid or expired code');
    }

    const otpData: OtpData = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Check max attempts
    if (otpData.attempts >= MAX_ATTEMPTS) {
      // Invalidate OTP after too many attempts
      await redis.del(OTP_KEY(phone));
      throw new UnauthorizedError('Invalid or expired code');
    }

    // Increment attempts
    otpData.attempts += 1;
    await redis.set(OTP_KEY(phone), JSON.stringify(otpData));
    await redis.expire(OTP_KEY(phone), OTP_TTL);

    // Check code
    if (otpData.code !== code) {
      // If this was the last attempt, invalidate
      if (otpData.attempts >= MAX_ATTEMPTS) {
        await redis.del(OTP_KEY(phone));
      }
      throw new UnauthorizedError('Invalid or expired code');
    }

    // Success — delete OTP (single-use)
    await redis.del(OTP_KEY(phone));

    return true;
  }
}
