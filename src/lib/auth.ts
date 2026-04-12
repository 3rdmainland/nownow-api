import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from './errors.js';

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

export async function authenticateVendor(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }

  const payload = request.user as { role?: string };
  if (payload.role !== 'vendor') {
    throw new UnauthorizedError('Access denied');
  }
}

/** Authenticate as vendor OR admin (for admin override routes). */
export async function authenticateVendorOrAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }

  const payload = request.user as { role?: string };
  if (payload.role !== 'vendor' && payload.role !== 'admin') {
    throw new UnauthorizedError('Access denied');
  }
}

/** Authenticate as organizer OR admin. */
export async function authenticateOrganizerOrAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }

  const payload = request.user as { role?: string };
  if (payload.role !== 'organizer' && payload.role !== 'admin') {
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
/**
 * Assert the authenticated vendor owns the resource identified by vendorId.
 * Admins bypass the check. Throws 403 if ownership fails.
 */
export function assertVendorOwnership(request: FastifyRequest, vendorId: string): void {
  const user = request.user as { vendorId?: string; role?: string };
  if (user.role === 'admin') return; // admins can access anything
  if (!user.vendorId || user.vendorId !== vendorId) {
    throw new ForbiddenError('You do not have access to this vendor\'s resources');
  }
}

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
