import { vi } from 'vitest';

/**
 * Creates a chainable Supabase query builder mock.
 *
 * Usage:
 *   mockSupabaseFrom({ data: [{ id: '1', name: 'Test' }], error: null })
 */
export function createSupabaseMock(defaultResponse: { data: any; error: any; count?: number } = { data: null, error: null }) {
  const responseWithCount = {
    data: defaultResponse.data,
    error: defaultResponse.error,
    count: defaultResponse.count ?? (Array.isArray(defaultResponse.data) ? defaultResponse.data.length : 0),
  };

  const builder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(defaultResponse),
    maybeSingle: vi.fn().mockResolvedValue(defaultResponse),
    then: vi.fn((resolve: (val: any) => any) => Promise.resolve(resolve(responseWithCount))),
  };

  // Make the builder thenable so `await supabase.from(...).select(...)` works
  Object.defineProperty(builder, Symbol.toStringTag, { value: 'Promise' });

  return builder;
}

/**
 * Full supabase client mock.
 * Call supabaseMock.from.mockReturnValue(createSupabaseMock({ data: ..., error: null }))
 * before each test to control responses.
 */
export const supabaseMock = {
  from: vi.fn(),
  storage: {
    from: vi.fn().mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: 'test/path.png' }, error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.test/path.png' } }),
    }),
  },
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
};

/** Reset all mocks between tests */
export function resetSupabaseMock() {
  vi.clearAllMocks();
}
