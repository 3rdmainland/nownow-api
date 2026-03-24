const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

export const operationalSnapshotSchema = {
  description: 'Get operational snapshot for admin dashboard',
  tags: ['admin'],
  response: {
    200: {
      type: 'object',
      properties: {
        pendingOrders: { type: 'number' },
        failedPayments: { type: 'number' },
        staleOrders: { type: 'number' },
        activeEvents: { type: 'number' },
        wsConnections: { type: 'number' },
        ordersLast24h: { type: 'number' },
        revenueLast24h: { type: 'number' },
        recentOrders: { type: 'array' },
      },
    },
  },
};

export const globalSearchSchema = {
  description: 'Global search across orders, events, customers, vendors',
  tags: ['admin'],
  querystring: {
    type: 'object',
    required: ['q'],
    properties: {
      q: { type: 'string', minLength: 1 },
      limit: { type: 'number', default: 5 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        orders: { type: 'array' },
        events: { type: 'array' },
        customers: { type: 'array' },
        vendors: { type: 'array' },
      },
    },
  },
};

export const customerProfileSchema = {
  description: 'Get customer profile by phone',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['phone'],
    properties: { phone: { type: 'string' } },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        phone: { type: 'string' },
        name: { type: ['string', 'null'] },
        createdAt: { type: 'string' },
        orderCount: { type: 'number' },
        totalSpend: { type: 'number' },
      },
    },
    404: errorResponse,
  },
};

export const customerOrdersSchema = {
  description: 'Get customer order history',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['phone'],
    properties: { phone: { type: 'string' } },
  },
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'number', default: 1 },
      limit: { type: 'number', default: 20 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        orders: { type: 'array' },
        total: { type: 'number' },
      },
    },
  },
};

export const overrideOrderStatusSchema = {
  description: 'Override order status',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['status', 'reason'],
    properties: {
      status: { type: 'string' },
      reason: { type: 'string', minLength: 1 },
    },
  },
  response: { 200: { type: 'object', properties: { message: { type: 'string' } } }, 404: errorResponse },
};

export const adminRefundSchema = {
  description: 'Admin refund order',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['type', 'reason'],
    properties: {
      type: { type: 'string', enum: ['full', 'partial'] },
      amount: { type: 'number' },
      reason: { type: 'string', minLength: 1 },
    },
  },
  response: { 200: { type: 'object', properties: { message: { type: 'string' } } }, 404: errorResponse },
};

export const reconciliationSchema = {
  description: 'Get reconciliation report',
  tags: ['admin'],
  querystring: {
    type: 'object',
    properties: {
      startDate: { type: 'string' },
      endDate: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        totalGrossSales: { type: 'number' },
        totalServiceFees: { type: 'number' },
        totalPlatformFees: { type: 'number' },
        totalNetToVendors: { type: 'number' },
        totalRefunds: { type: 'number' },
        paymentMethodBreakdown: { type: 'object', additionalProperties: true },
        byVendor: { type: 'array' },
        byEvent: { type: 'array' },
      },
    },
  },
};

export const alertsSchema = {
  description: 'Get active alerts',
  tags: ['admin'],
  response: { 200: { type: 'array' } },
};

export const acknowledgeAlertSchema = {
  description: 'Acknowledge an alert',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  response: { 200: { type: 'object', properties: { message: { type: 'string' } } } },
};

export const systemHealthSchema = {
  description: 'Get system health diagnostics',
  tags: ['admin'],
  response: {
    200: {
      type: 'object',
      properties: {
        api: { type: 'object', additionalProperties: true },
        redis: { type: 'object', additionalProperties: true },
        database: { type: 'object', additionalProperties: true },
        websocket: { type: 'object', additionalProperties: true },
        recentErrors: { type: 'array' },
      },
    },
  },
};

const analyticsQuerystring = {
  type: 'object',
  properties: {
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    eventId: { type: 'string' },
  },
};

export const peakHoursSchema = {
  description: 'Get peak hours analysis',
  tags: ['admin'],
  querystring: analyticsQuerystring,
  response: {
    200: {
      type: 'object',
      properties: {
        hourlyDistribution: { type: 'array' },
        peakHour: { type: 'number' },
        quietHour: { type: 'number' },
      },
    },
  },
};

export const vendorPerformanceSchema = {
  description: 'Get vendor performance analytics',
  tags: ['admin'],
  querystring: analyticsQuerystring,
  response: { 200: { type: 'array' } },
};

export const popularItemsSchema = {
  description: 'Get popular items ranking',
  tags: ['admin'],
  querystring: {
    type: 'object',
    properties: {
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      eventId: { type: 'string' },
      limit: { type: 'number', default: 20 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        items: { type: 'array' },
      },
    },
  },
};

export const conversionFunnelSchema = {
  description: 'Get conversion funnel data',
  tags: ['admin'],
  querystring: analyticsQuerystring,
  response: {
    200: {
      type: 'object',
      properties: {
        paymentInitiated: { type: 'number' },
        paymentCompleted: { type: 'number' },
        orderCollected: { type: 'number' },
        orderCancelled: { type: 'number' },
      },
    },
  },
};

export const platformStatsSchema = {
  description: 'Get platform-wide statistics',
  tags: ['admin'],
  response: {
    200: {
      type: 'object',
      properties: {
        totalOrders: { type: 'number' },
        totalRevenue: { type: 'number' },
        totalEvents: { type: 'number' },
        totalVendors: { type: 'number' },
        totalOrganizers: { type: 'number' },
        totalCustomers: { type: 'number' },
      },
    },
  },
};

export const userListSchema = {
  description: 'List users by type with search',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer', 'customer'] },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      search: { type: 'string' },
      page: { type: 'number', default: 1 },
      limit: { type: 'number', default: 20 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        users: { type: 'array' },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
    400: errorResponse,
  },
};

export const suspendUserSchema = {
  description: 'Suspend a user',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer', 'customer'] },
      id: { type: 'string' },
    },
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' } } },
    404: errorResponse,
  },
};

export const unsuspendUserSchema = {
  description: 'Unsuspend a user',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer', 'customer'] },
      id: { type: 'string' },
    },
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' } } },
    404: errorResponse,
  },
};

export const getUserDetailSchema = {
  description: 'Get detailed user info by type and ID',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer', 'customer'] },
      id: { type: 'string' },
    },
  },
  response: {
    200: { type: 'object', additionalProperties: true },
    404: errorResponse,
  },
};

export const updateUserSchema = {
  description: 'Update user fields by type and ID',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer', 'customer'] },
      id: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    additionalProperties: true,
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' } } },
    404: errorResponse,
  },
};

export const deleteUserSchema = {
  description: 'Delete a user by type and ID',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer', 'customer'] },
      id: { type: 'string' },
    },
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' } } },
    404: errorResponse,
  },
};

export const inviteUserSchema = {
  description: 'Invite a vendor or organizer user',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer'] },
    },
  },
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
      vendorId: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        inviteToken: { type: 'string' },
        expiresAt: { type: 'string' },
      },
    },
    400: errorResponse,
  },
};

export const sendResetLinkSchema = {
  description: 'Generate a password reset link for a user',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer'] },
      id: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        resetUrl: { type: 'string' },
      },
    },
    404: errorResponse,
  },
};

export const resetUserPasswordSchema = {
  description: 'Admin-initiated password reset for a user',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', enum: ['vendor', 'organizer'] },
      id: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    required: ['newPassword'],
    properties: {
      newPassword: { type: 'string', minLength: 8 },
    },
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' } } },
    404: errorResponse,
  },
};

export const auditLogsSchema = {
  description: 'Get admin audit logs',
  tags: ['admin'],
  querystring: {
    type: 'object',
    properties: {
      adminUserId: { type: 'string' },
      action: { type: 'string' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      page: { type: 'number', default: 1 },
      limit: { type: 'number', default: 50 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        logs: { type: 'array' },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
};

export const getConfigSchema = {
  description: 'Get all platform config entries',
  tags: ['admin'],
  response: {
    200: {
      type: 'object',
      properties: {
        config: { type: 'array' },
      },
    },
  },
};

export const setConfigSchema = {
  description: 'Set a platform config entry',
  tags: ['admin'],
  params: {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    required: ['value'],
    properties: {
      value: {},
    },
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' } } },
  },
};

export const vendorPipelineSchema = {
  description: 'Get vendor onboarding pipeline with vendor details',
  tags: ['admin'],
  response: {
    200: {
      type: 'object',
      properties: {
        stages: { type: 'array' },
      },
    },
  },
};

export const stakeholderStatsSchema = {
  description: 'Get comprehensive stakeholder stats (customers, vendors, organizers)',
  tags: ['admin'],
  response: {
    200: {
      type: 'object',
      properties: {
        customers: { type: 'object', additionalProperties: true },
        vendors: { type: 'object', additionalProperties: true },
        organizers: { type: 'object', additionalProperties: true },
      },
    },
  },
};

export const revenueReportSchema = {
  description: 'Get revenue report',
  tags: ['admin'],
  querystring: {
    type: 'object',
    properties: {
      startDate: { type: 'string' },
      endDate: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        totalRevenue: { type: 'number' },
        orderCount: { type: 'number' },
        averageOrderValue: { type: 'number' },
        byDay: { type: 'array' },
      },
    },
  },
};
