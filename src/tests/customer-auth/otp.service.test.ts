import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redisMock, cacheMock, CACHE_TTL_MOCK } from '../mocks/redis.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/redis.js', () => ({
  default: redisMock,
  redis: redisMock,
  cache: cacheMock,
  CACHE_TTL: CACHE_TTL_MOCK,
}));

import { OtpService } from '../../customer-auth/otp.service.js';

describe('OtpService', () => {
  let otpService: OtpService;

  beforeEach(() => {
    vi.clearAllMocks();
    otpService = new OtpService();
    // Default: no cooldown, no hourly limit
    redisMock.exists.mockResolvedValue(0);
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');
    redisMock.expire.mockResolvedValue(1);
    redisMock.incr.mockResolvedValue(1);
    redisMock.del.mockResolvedValue(1);
  });

  // ── generateOtp ─────────────────────────────────────────────────────────────

  describe('generateOtp', () => {
    it('generates a 6-digit code and stores it in Redis', async () => {
      const code = await otpService.generateOtp('27821234567');

      expect(code).toMatch(/^\d{6}$/);
      expect(redisMock.set).toHaveBeenCalled();
      expect(redisMock.expire).toHaveBeenCalled();
    });

    it('sets a 60s cooldown after generating OTP', async () => {
      await otpService.generateOtp('27821234567');

      // Should set cooldown key
      const cooldownCalls = redisMock.set.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('cooldown')
      );
      expect(cooldownCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('increments hourly counter', async () => {
      await otpService.generateOtp('27821234567');

      expect(redisMock.incr).toHaveBeenCalled();
    });

    it('throws TooManyRequestsError when cooldown is active', async () => {
      redisMock.exists.mockResolvedValueOnce(1); // cooldown exists

      await expect(otpService.generateOtp('27821234567')).rejects.toThrow(
        'Please wait before requesting another code'
      );
    });

    it('throws TooManyRequestsError when hourly limit is reached', async () => {
      redisMock.exists.mockResolvedValueOnce(0); // no cooldown
      redisMock.get.mockResolvedValueOnce(5); // hourly count = 5 (max)

      await expect(otpService.generateOtp('27821234567')).rejects.toThrow(
        'Too many verification attempts'
      );
    });

    it('allows OTP when hourly count is below limit', async () => {
      redisMock.exists.mockResolvedValueOnce(0);
      redisMock.get.mockResolvedValueOnce(4); // below max of 5

      const code = await otpService.generateOtp('27821234567');
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  // ── verifyOtp ───────────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    it('returns true for a correct code and deletes OTP', async () => {
      const otpData = JSON.stringify({ code: '123456', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(otpData);

      const result = await otpService.verifyOtp('27821234567', '123456');

      expect(result).toBe(true);
      expect(redisMock.del).toHaveBeenCalled();
    });

    it('throws UnauthorizedError for wrong code', async () => {
      const otpData = JSON.stringify({ code: '123456', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(otpData);

      await expect(otpService.verifyOtp('27821234567', '000000')).rejects.toThrow(
        'Invalid or expired code'
      );
    });

    it('throws UnauthorizedError when OTP does not exist (expired)', async () => {
      redisMock.get.mockResolvedValueOnce(null);

      await expect(otpService.verifyOtp('27821234567', '123456')).rejects.toThrow(
        'Invalid or expired code'
      );
    });

    it('increments attempts on each verify call', async () => {
      const otpData = JSON.stringify({ code: '123456', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(otpData);

      await expect(otpService.verifyOtp('27821234567', '000000')).rejects.toThrow();

      // Should have stored updated attempts
      const setCalls = redisMock.set.mock.calls;
      const otpSetCall = setCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].startsWith('otp:') && !call[0].includes('cooldown') && !call[0].includes('hourly')
      );
      expect(otpSetCall).toBeDefined();
      const stored = JSON.parse(otpSetCall![1] as string);
      expect(stored.attempts).toBe(1);
    });

    it('invalidates OTP after 5 failed attempts', async () => {
      const otpData = JSON.stringify({ code: '123456', attempts: 4 }); // 4th attempt already done
      redisMock.get.mockResolvedValueOnce(otpData);

      await expect(otpService.verifyOtp('27821234567', '000000')).rejects.toThrow(
        'Invalid or expired code'
      );

      // OTP should be deleted after max attempts
      expect(redisMock.del).toHaveBeenCalled();
    });

    it('rejects when max attempts already reached', async () => {
      const otpData = JSON.stringify({ code: '123456', attempts: 5 });
      redisMock.get.mockResolvedValueOnce(otpData);

      await expect(otpService.verifyOtp('27821234567', '123456')).rejects.toThrow(
        'Invalid or expired code'
      );

      // OTP deleted
      expect(redisMock.del).toHaveBeenCalled();
    });

    it('handles OtpData stored as parsed object (Upstash auto-parse)', async () => {
      // Upstash may return already-parsed JSON
      redisMock.get.mockResolvedValueOnce({ code: '654321', attempts: 0 });

      const result = await otpService.verifyOtp('27821234567', '654321');
      expect(result).toBe(true);
    });
  });
});
