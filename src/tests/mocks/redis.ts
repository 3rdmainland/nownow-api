import { vi } from 'vitest';

export const cacheMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
};

export const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  exists: vi.fn().mockResolvedValue(0),
  ping: vi.fn().mockResolvedValue('PONG'),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
};

export const CACHE_TTL_MOCK = {
  ACTIVE_ORDERS: 5,
  MENU_ITEMS: 300,
  USER_SESSION: 3600,
  VENDOR_LIST: 3600,
  VENDOR_DETAILS: 60,
};

export function resetRedisMock() {
  vi.clearAllMocks();
}
