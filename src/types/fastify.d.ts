import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      userId: string;
      vendorId: string;
      email: string;
    };
    user: {
      userId: string;
      vendorId: string;
      email: string;
    };
  }
}
