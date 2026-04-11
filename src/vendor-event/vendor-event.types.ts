export type OriginType = 'organizer' | 'vendor' | 'vendor_direct';

export interface VendorEvent {
  id: string;
  eventId: string;
  vendorId: string;
  qrCode: string;
  qrImage: string;
  menuTemplateId: string | null;
  isDirect: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VendorEventWithDetails extends VendorEvent {
  eventName: string;
  eventCode: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface CreateVendorEventPayload {
  name: string;
  startDate: string;
  endDate: string;
  menuTemplateId?: string;
  allowPayAtStall?: boolean;
}
