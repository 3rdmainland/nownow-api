import '@fastify/jwt';
import '@fastify/cookie';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      userId: string;
      email: string;
      vendorId?: string;
      role?: 'organizer' | 'vendor';
    };
    user: {
      userId: string;
      email: string;
      vendorId?: string;
      role?: 'organizer' | 'vendor';
    };
  }
}
