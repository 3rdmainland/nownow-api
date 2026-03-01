import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { AppError } from '../../lib/errors.js';

/**
 * Build a minimal Fastify test instance without starting a server.
 * Registers only the plugins and routes you pass in via the `routes` callback.
 */
export async function buildApp(
  routes?: (app: FastifyInstance) => Promise<void>
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    cookie: { cookieName: 'token', signed: false },
  });

  app.setErrorHandler((error, request, reply) => {
    if ((error as any)?.code === 'FST_ERR_VALIDATION') {
      return reply.status(400).send({ error: error.message });
    }
    if (error instanceof AppError && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    return reply.status(500).send({ error: 'Internal server error' });
  });

  if (routes) {
    await routes(app);
  }

  await app.ready();
  return app;
}

/**
 * Generate a signed JWT token for testing protected routes.
 */
export function generateToken(
  app: FastifyInstance,
  payload: {
    userId: string;
    vendorId?: string;
    email: string;
    role: 'vendor' | 'organizer';
  }
): string {
  return app.jwt.sign(payload, { expiresIn: '1h' });
}
