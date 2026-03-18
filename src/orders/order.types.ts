export interface OrderItem {
    id: string;
    name: string;
    price: number;
    imageUrl: string;
    prepTime: number;
    quantity: number;
    vendorId: string;
    vendorName: string;
    selectedModifiers?: Record<string, string[]>; // Map of modifier group IDs to selected modifier IDs
    modifierSummary?: string; // Human-readable summary of modifiers (e.g., "Family Size, Extra Cheese")
}

export enum OrderType {
    CART = 'CART',
    ORDER = 'ORDER',
    CANCELLED = 'CANCELLED'
}

export enum OrderStatus {
    PAYMENT_PENDING = 'PAYMENT_PENDING',
    PENDING = 'PENDING',
    PREPARING = 'PREPARING',
    READY = 'READY',
    COLLECTED = 'COLLECTED',
    CANCELLED = 'CANCELLED',
}

export interface Order {
    id: string;
    vendor_id: string;
    event_id: string;
    phone: string;
    items: OrderItem[];
    total: number;
    status: OrderStatus;
    type: OrderType;
    notes?: string;
    estimatedPrepTime?: number;
    paymentMethod?: string;
    service_fee?: number;
    qr_code: string;
    created_at: string;
    collected_at?: string;
    prepared_at?: string;
    ready_at?: string;
    stitch_payment_id?: string;
    payment_status?: 'none' | 'pending' | 'complete' | 'cancelled' | 'expired' | 'failed' | 'pay_at_stall';
    paid_at?: string;
    qr_image?: string;
    scheduled_pickup_time?: string;
    actual_prep_time?: number;
    queue_position?: number;
    estimated_ready_time?: string;
    vendor?: { name: string };
    stall_info?: string | null;
}

export interface PaginationParams {
    page?: number;
    pageSize?: number;
}

export interface PaginatedResponse<T> {
    orders: T[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

export interface OrderStats {
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
    ordersByStatus: Record<string, number>;
    grossSales: number;
    collectedRevenue: number;
    cancelledCount: number;
    cancelledValue: number;
    topItem: { name: string; qty: number } | null;
    paymentBreakdown: Record<string, number>;
    topItems: Array<{ name: string; qty: number }>;
}

export type TimeSeriesGranularity = 'day' | 'week' | 'month';

export interface TimeSeriesBucket {
    date: string;
    revenue: number;
    orderCount: number;
    collectedRevenue: number;
    cancelledCount: number;
}

export interface TimeSeriesSummary {
    grossSales: number;
    collectedRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    cancelledCount: number;
    cancelledValue: number;
    paymentBreakdown: Record<string, number>;
    ordersByStatus: Record<string, number>;
    topItems: Array<{ name: string; qty: number }>;
}

export interface PreviousPeriodSummary {
    grossSales: number;
    collectedRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
}

export interface TimeSeriesStats {
    buckets: TimeSeriesBucket[];
    summary: TimeSeriesSummary;
    previousPeriod: PreviousPeriodSummary;
}
