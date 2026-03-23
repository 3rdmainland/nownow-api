export interface PlatformStats {
  totalOrders: number;
  totalRevenue: number;
  totalEvents: number;
  totalVendors: number;
  totalOrganizers: number;
  totalCustomers: number;
}

export interface AuditLogEntry {
  id: string;
  adminUserId: string;
  adminEmail?: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface PlatformConfigEntry {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PipelineVendor {
  id: string;
  name: string | null;
  email: string;
  date: string;
}

export interface VendorPipelineStage {
  stage: string;
  count: number;
  vendors: PipelineVendor[];
}

export interface StakeholderStats {
  customers: {
    total: number;
    active30d: number;
    repeatRate: number;
    avgSpend: number;
    totalSpend: number;
    newLast7d: number;
    newLast30d: number;
  };
  vendors: {
    total: number;
    active: number;
    avgOrdersPerVendor: number;
    avgRevenuePerVendor: number;
    totalMenuItems: number;
    topPerformers: { id: string; name: string; orders: number; revenue: number }[];
  };
  organizers: {
    total: number;
    totalEventsCreated: number;
    activeEvents: number;
    avgEventsPerOrganizer: number;
    topOrganizers: { id: string; name: string; events: number }[];
  };
}

export interface RevenueReport {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  byDay: { date: string; revenue: number; orders: number }[];
}

export interface AdminOrderSummary {
  id: string;
  customerPhone: string | null;
  customerName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  eventId: string | null;
  total: number;
  status: string;
  paymentStatus: string | null;
  createdAt: string;
  eventName: string | null;
}

export interface OperationalSnapshot {
  pendingOrders: number;
  failedPayments: number;
  staleOrders: number;
  activeEvents: number;
  wsConnections: number;
  ordersLast24h: number;
  revenueLast24h: number;
  recentOrders: AdminOrderSummary[];
}

export interface GlobalSearchResult {
  orders: AdminOrderSummary[];
  events: { id: string; name: string; code: string; startDate: string | null; status: string }[];
  customers: { id: string; phone: string; name: string | null; createdAt: string }[];
  vendors: { id: string; name: string; email: string }[];
}

export interface CustomerProfile {
  id: string;
  phone: string;
  name: string | null;
  createdAt: string;
  orderCount: number;
  totalSpend: number;
}

export interface PeakHoursAnalysis {
  hourlyDistribution: { hour: number; orderCount: number; revenue: number }[];
  peakHour: number;
  quietHour: number;
}

export interface VendorPerformance {
  vendorId: string;
  vendorName: string;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  completionRate: number;
  avgPrepTimeMinutes: number;
  avgTotalTimeMinutes: number;
  revenue: number;
  avgOrderValue: number;
  topItems: { name: string; quantity: number }[];
}

export interface PopularItemsRanking {
  items: {
    name: string;
    totalQuantity: number;
    totalRevenue: number;
    vendorName: string;
    orderCount: number;
  }[];
}

export interface ConversionFunnel {
  paymentInitiated: number;
  paymentCompleted: number;
  orderCollected: number;
  orderCancelled: number;
}

export interface ReconciliationReport {
  totalGrossSales: number;
  totalServiceFees: number;
  totalPlatformFees: number;
  totalNetToVendors: number;
  totalRefunds: number;
  paymentMethodBreakdown: Record<string, { count: number; total: number }>;
  byVendor: {
    vendorId: string;
    vendorName: string;
    grossSales: number;
    serviceFee: number;
    platformFee: number;
    netPayout: number;
    orderCount: number;
    refundCount: number;
    refundAmount: number;
  }[];
  byEvent: {
    eventId: string;
    eventName: string;
    grossSales: number;
    orderCount: number;
    vendorCount: number;
  }[];
}

export interface Alert {
  id: string;
  type: 'failed_payment' | 'stale_order' | 'vendor_no_activity' | 'high_cancellation';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  resourceId: string | null;
  resourceType: string | null;
  createdAt: string;
  acknowledged: boolean;
}

export interface SystemHealth {
  api: { status: string; uptime: number; memoryUsage: { rss: number; heapUsed: number; heapTotal: number } };
  redis: { status: string; latencyMs: number };
  database: { status: string; latencyMs: number };
  websocket: { totalConnections: number };
  recentErrors: { method: string; path: string; statusCode: number; message: string; timestamp: string }[];
}

export interface UserListParams {
  type: 'vendor' | 'organizer' | 'customer';
  search?: string;
  page?: number;
  limit?: number;
}
