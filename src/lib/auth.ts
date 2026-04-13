import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from './errors.js';
import { supabase } from './supabase.js';
import type { VendorRole } from '../staff/staff.types.js';

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

/**
 * Middleware: checks the authenticated user has one of the allowed roles
 * on the vendor specified by :id or :vendorId in route params.
 * Must be called AFTER authenticateVendor.
 */
export function assertVendorRole(allowedRoles: VendorRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string; vendorId: string; role: string };
    const vendorId = (request.params as any).id || (request.params as any).vendorId || user.vendorId;

    const { data, error } = await supabase
      .from('vendor_user_roles')
      .select('role')
      .eq('user_id', user.userId)
      .eq('vendor_id', vendorId)
      .single();

    if (error || !data) {
      throw new ForbiddenError('No access to this vendor');
    }

    if (!allowedRoles.includes(data.role as VendorRole)) {
      throw new ForbiddenError(`Requires role: ${allowedRoles.join(' or ')}`);
    }

    (request as any).vendorRole = data.role;
  };
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
