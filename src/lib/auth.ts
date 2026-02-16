import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from './errors.js';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Authentication required');
  }
}
