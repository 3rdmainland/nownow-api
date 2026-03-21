import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from './errors.js';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }
}

export async function authenticateOrganizer(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }

  const payload = request.user as { role?: string };
  if (payload.role !== 'organizer') {
    throw new UnauthorizedError('Access denied');
  }
}

export async function authenticateCustomer(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }

  const payload = request.user as { role?: string };
  if (payload.role !== 'customer') {
    throw new UnauthorizedError('Access denied');
  }
}

export async function authenticateAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }

  const payload = request.user as { role?: string };
  if (payload.role !== 'admin') {
    throw new UnauthorizedError('Access denied');
  }
}

/**
 * Optional customer auth — sets request.user if valid JWT with customer role,
 * otherwise silently continues (no error).
 */
export async function optionalAuthenticateCustomer(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { role?: string };
    if (payload.role !== 'customer') {
      // Valid JWT but not a customer — clear user so downstream doesn't use it
      (request as any).user = undefined;
    }
  } catch {
    // No valid token — that's fine, guest user
    (request as any).user = undefined;
  }
}
