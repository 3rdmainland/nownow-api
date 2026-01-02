import Fastify from "fastify";
import orderController from "./orders/order.controller";
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import vendorController from "./vendor/vendor.controller";
import eventController from "./event/event.controller";
import categoryController from "./category/category.controller";
import vendorMenuController from "./vendor/menu/vendor-menu.controller";
import fastifyCors from "@fastify/cors";
import redis from "./lib/redis";
import whatsappController from "./whatsapp/whatsapp.controller";

const fastify = Fastify({ logger: true });

// CORS
await fastify.register(fastifyCors, {
    origin: ["http://localhost:3000","http://localhost:3001","http://localhost:3003",
        "https://nownow-dev-api-production.up.railway.app", "https://nownow-9w671nzrv-jenyojohnson-gmailcoms-projects.vercel.app"],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // credentials: true, // uncomment if you use cookies/auth headers cross-site
});

// Register Swagger
await fastify.register(fastifySwagger, {
    openapi: {
        info: {
            title: 'Your API',
            version: '1.0.0'
        }
    }
});

// Register Swagger UI
await fastify.register(fastifySwaggerUI, {
    routePrefix: '/documentation'
});

// Register order controller with prefix
fastify.register(orderController, { prefix: "/orders" });
// Register vendor menu routes BEFORE generic vendor routes so that
// specific paths like "/vendor/:vendorId/menu/default" take precedence
fastify.register(vendorMenuController, { prefix: "/vendor" });
fastify.register(vendorController, { prefix: "/vendor" });
fastify.register(eventController, { prefix: "/event" });
fastify.register(categoryController, { prefix: "/category" });
fastify.register(whatsappController, { prefix: "/whatsapp" });

// Register health check route with redis
fastify.get('/health', async (request, reply) => {
    try {
        // Test Redis connection
        await redis.ping()

        return {
            status: 'healthy',
            redis: 'connected',
            timestamp: new Date().toISOString(),
        }
    } catch (error: any) {
        return reply.code(503).send({
            status: 'unhealthy',
            redis: 'disconnected',
            error: error.message,
        })
    }
})


fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    if ((error as any)?.message?.includes("Database") || (error as any)?.code) {
        return reply.status(500).send({ error: "Supabase request failed" });
    }

    return reply.status(500).send({ error: "Internal server error" });
});

(async () => {
    try {
        const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '3002', 10);
        await fastify.listen({ port, host: "0.0.0.0" });
        fastify.log.info(`Server running at http://localhost:${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
})();
