import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import fastifyCompress from "@fastify/compress";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
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
import uploadController from "./upload/upload.controller";
import paymentController from "./payment/payment.controller.js";
import customerAuthController from "./customer-auth/customer-auth.controller";
import adminAuthController from "./admin-auth/admin-auth.controller";
import adminController from "./admin/admin.controller";
import supportController from "./support/support.controller";
import customerSupportController from "./support/customer-support.controller";
import retentionController from "./retention/retention.controller";
import nudgeEndpoint from "./retention/nudge.endpoint";
import whatsappWebhook from "./whatsapp/whatsapp.webhook";
import legalController from "./legal/legal.controller";
import { AppError } from "./lib/errors";

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}

// Error tracking ring buffer for admin health endpoint
interface TrackedError {
    method: string;
    path: string;
    statusCode: number;
    message: string;
    timestamp: string;
}

const recentErrors: TrackedError[] = [];
const MAX_TRACKED_ERRORS = 100;

export function getRecentErrors(): TrackedError[] {
    return [...recentErrors];
}

function trackError(error: TrackedError): void {
    recentErrors.unshift(error);
    if (recentErrors.length > MAX_TRACKED_ERRORS) {
        recentErrors.pop();
    }
}

const fastify = Fastify({ logger: true });

// CORS
await fastify.register(fastifyCors, {
    origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3003",
        "http://localhost:3004",
        "https://nownow-dev-api-production.up.railway.app",
        "https://nownow-nine.vercel.app",
        "https://nownow-vendor.vercel.app",
        "https://nownow-organizer.vercel.app",
        "https://nownow-admin.vercel.app"
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Upstash-Signature'],
    credentials: true,
});

// Response compression (brotli + gzip)
await fastify.register(fastifyCompress, {
    encodings: ['br', 'gzip', 'deflate'],
});

// Security headers
await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Disable CSP for API-only server
});

// Rate limiting (local store — Upstash REST client is not ioredis-compatible)
await fastify.register(fastifyRateLimit, {
    max: process.env.NODE_ENV === 'test' ? 10_000 : 100,
    timeWindow: '1 minute',
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
fastify.register(uploadController, { prefix: "/upload" });
fastify.register(paymentController, { prefix: "/payment" });
fastify.register(customerAuthController, { prefix: "/customer/auth" });
fastify.register(adminAuthController, { prefix: "/admin/auth" });
fastify.register(adminController, { prefix: "/admin" });
fastify.register(supportController, { prefix: "/support" });
fastify.register(customerSupportController, { prefix: "/customer/support" });
fastify.register(retentionController, { prefix: "/retention" });
fastify.register(nudgeEndpoint, { prefix: "/internal/nudge" });
fastify.register(whatsappWebhook, { prefix: "/whatsapp/webhook" });
fastify.register(legalController, { prefix: "/legal" });

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

    const statusCode = (error as any)?.statusCode || 500;

    // Track errors for admin health dashboard
    trackError({
        method: request.method,
        path: request.url,
        statusCode,
        message: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
    });

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
