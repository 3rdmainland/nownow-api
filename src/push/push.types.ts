export interface PushSubscriptionInput {
  userType: 'vendor' | 'customer' | 'admin';
  userId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url: string;
    type: string;
    orderId?: string;
  };
  tag?: string;
}
