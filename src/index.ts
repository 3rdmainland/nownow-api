import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
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
import { websocketController } from "./websocket";
import authController from "./auth/auth.controller";
import discountController from "./discount/discount.controller";
import organizerAuthController from "./organizer/organizer-auth.controller";
import { AppError } from "./lib/errors";

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}

const fastify = Fastify({ logger: true });

// CORS
await fastify.register(fastifyCors, {
    origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3003",
        "https://nownow-dev-api-production.up.railway.app",
        "https://nownow-nine.vercel.app",
        "https://nownow-vendor.vercel.app",
        "https://nownow-organizer.vercel.app"
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
});

// Cookie & JWT
await fastify.register(fastifyCookie);
await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET,
    cookie: {
        cookieName: 'token',
        signed: false,
    },
});

// Register Swagger
await fastify.register(fastifySwagger, {
    openapi: {
        info: {
            title: 'Now Now API',
            version: '1.0.0'
        }
    }
});

// Register Swagger UI
await fastify.register(fastifySwaggerUI, {
    routePrefix: '/documentation'
});

// Register WebSocket controller (must be before other routes)
fastify.register(websocketController);

// Register order controller with prefix
fastify.register(orderController, { prefix: "/orders" });
// Register vendor menu routes BEFORE generic vendor routes so that
// specific paths like "/vendor/:vendorId/menu/default" take precedence
fastify.register(vendorMenuController, { prefix: "/vendor" });
fastify.register(vendorController, { prefix: "/vendor" });
fastify.register(eventController, { prefix: "/event" });
fastify.register(categoryController, { prefix: "/category" });
fastify.register(whatsappController, { prefix: "/whatsapp" });
fastify.register(authController, { prefix: "/auth" });
fastify.register(discountController, { prefix: "/discount" });
fastify.register(organizerAuthController, { prefix: "/organizer/auth" });

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

    // Fastify schema validation errors (FST_ERR_VALIDATION) — return 400
    if ((error as any)?.code === 'FST_ERR_VALIDATION') {
        return reply.status(400).send({ error: error.message });
    }

    // Handle custom AppError subclasses (UnauthorizedError, ConflictError, etc.)
    if (error instanceof AppError && error.statusCode < 500) {
        return reply.status(error.statusCode).send({ error: error.message });
    }

    if ((error as any)?.message?.includes("Database")) {
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
