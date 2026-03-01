// Global test environment setup
// Sets all required env vars before any module is imported
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
process.env.NODE_ENV = 'test';
process.env.VENDOR_APP_URL = 'http://localhost:3001';
process.env.WA_API_VERSION = 'v18.0';
process.env.WA_PHONE_NUMBER_ID = 'test-phone-id';
process.env.WA_ACCESS_TOKEN = 'test-wa-token';
