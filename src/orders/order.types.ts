export interface OrderItem {
    id: string;
    name: string;
    price: number;
    imageUrl: string;
    prepTime: number;
    quantity: number;
    vendorId: string;
    vendorName: string;
}

export enum OrderType {
    CART = 'CART',
    ORDER = 'ORDER',
    CANCELLED = 'CANCELLED'
}

export enum OrderStatus {
    PENDING = 'PENDING',
    PREPARING = 'PREPARING',
    READY = 'READY',
    COLLECTED = 'COLLECTED',
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
    qr_code: string;
    created_at: string;
    collected_at?: string;
    prepared_at?: string;
    ready_at?: string;
    qr_image?: string;
    scheduled_pickup_time?: string;
    actual_prep_time?: number;
    queue_position?: number;
    estimated_ready_time?: string;
}
