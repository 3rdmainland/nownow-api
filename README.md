 NowNow API

 Fastify + TypeScript REST API with Swagger docs and Upstash Redis caching.

 Quick start
 - Prerequisites: Node.js 18+, npm, Upstash Redis account
 - Install: npm install
 - Configure env (.env in project root): SERVER_PORT, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 - Dev run: npm run dev
 - Swagger UI: GET /documentation
 - Health check: GET /health

 Environment variables
 - SERVER_PORT: Port to run the server (e.g., 3002)
 - UPSTASH_REDIS_REST_URL: Upstash Redis REST URL
 - UPSTASH_REDIS_REST_TOKEN: Upstash Redis REST token

 Notes
 - Routes are mounted under: /orders, /vendor, /event, /category, /whatsapp
 - See src/index.ts and src/lib/redis.ts for server and cache setup
