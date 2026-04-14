export interface Stall {
  id: string;
  eventId: string;
  vendorId: string;
  qrCode: string;
  qrImage: string;
  menuTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StallWithDetails extends Stall {
  eventName: string;
  eventCode: string;
  startDate: string;
  endDate: string;
  eventStatus: string;
  boothInfo: string | null;
}

export interface CreateStallPayload {
  eventId: string;
  menuTemplateId?: string;
  allowPayAtStall?: boolean;
  boothInfo?: string;
}
