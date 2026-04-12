import { FastifyPluginAsync } from 'fastify';
import {
  requestOtpSchema,
  verifyOtpSchema,
  meSchema,
  logoutSchema,
  updateProfileSchema,
} from './customer-auth.schema.js';
import { OtpService } from './otp.service.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { ConsoleSmsProvider, SmsProvider } from './sms.provider.js';
import { AfricasTalkingSmsProvider } from './africastalking-sms.provider.js';
import { authenticateCustomer } from '../lib/auth.js';
import { normalizePhone } from './phone.utils.js';
import type {
  RequestOtpPayload,
  VerifyOtpPayload,
  CustomerJwtPayload,
  UpdateProfilePayload,
} from './customer-auth.types.js';

const COOKIE_NAME = 'token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const customerAuthController: FastifyPluginAsync = async (fastify) => {
  const otpService = new OtpService();
  const customerAuthService = new CustomerAuthService();
  // Use Africa's Talking in production, console logger in dev/test
  const smsProvider: SmsProvider = process.env.AT_API_KEY
    ? new AfricasTalkingSmsProvider()
    : new ConsoleSmsProvider();

  // POST /customer/auth/request-otp — Send OTP to phone
  fastify.post('/request-otp', { schema: requestOtpSchema, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { phone } = request.body as RequestOtpPayload;
    const normalized = normalizePhone(phone);

    const code = await otpService.generateOtp(normalized);
    await smsProvider.sendOtp(normalized, code);

    // Always return the same message (anti-enumeration)
    const response: { message: string; otp?: string } = {
      message: 'Verification code sent',
    };

    // Only expose OTP in dev/test (console provider) — never in production
    if (!process.env.AT_API_KEY) {
      response.otp = code;
    }

    return response;
  });

  // POST /customer/auth/verify-otp — Verify OTP, issue JWT, auto-create customer
  fastify.post('/verify-otp', { schema: verifyOtpSchema, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { phone, code, name } = request.body as VerifyOtpPayload;
    const normalized = normalizePhone(phone);

    await otpService.verifyOtp(normalized, code);

    // Find or create customer (name is only used for new customers)
    const { isNewCustomer, ...customer } = await customerAuthService.findOrCreateByPhone(normalized, name);

    // Issue JWT
    const jwtPayload: CustomerJwtPayload = {
      customerId: customer.id,
      phone: customer.phone,
      role: 'customer',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: '7d' });

    reply
      .setCookie(COOKIE_NAME, jwtToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: COOKIE_MAX_AGE,
      })
      .send({ customer, isNewCustomer });
  });

  // GET /customer/auth/me — Get current customer (sliding session renewal)
  fastify.get('/me', {
    schema: meSchema,
    preHandler: [authenticateCustomer],
  }, async (request, reply) => {
    const { customerId } = request.user as CustomerJwtPayload;
    const customer = await customerAuthService.getCustomerById(customerId);

    if (!customer) {
      return reply.status(401).send({ error: 'Customer not found' });
    }

    // Renew session (sliding window)
    const jwtPayload: CustomerJwtPayload = {
      customerId: customer.id,
      phone: customer.phone,
      role: 'customer',
    };

    const jwtToken = fastify.jwt.sign(jwtPayload, { expiresIn: '7d' });

    reply
      .setCookie(COOKIE_NAME, jwtToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: COOKIE_MAX_AGE,
      })
      .send({ customer });
  });

  // POST /customer/auth/logout — Clear cookie
  fastify.post('/logout', { schema: logoutSchema }, async (request, reply) => {
    reply
      .clearCookie(COOKIE_NAME, { path: '/' })
      .send({ message: 'Logged out' });
  });

  // PATCH /customer/auth/profile — Update name
  fastify.patch('/profile', {
    schema: updateProfileSchema,
    preHandler: [authenticateCustomer],
  }, async (request, reply) => {
    const { customerId } = request.user as CustomerJwtPayload;
    const payload = request.body as UpdateProfilePayload;
    const customer = await customerAuthService.updateProfile(customerId, payload);
    return { customer };
  });
};

export default customerAuthController;
