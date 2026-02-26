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
