import 'fastify';

declare module 'fastify' {
    interface FastifyRequest {
        user: {
            id: number;
            name: string;
        }
    }
}
