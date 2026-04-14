import { Stall, StallWithDetails } from './stall.types.js';

export function fromDbStall(row: any): Stall {
  return {
    id: row.id,
    eventId: row.event_id,
    vendorId: row.vendor_id,
    qrCode: row.qr_code,
    qrImage: row.qr_image,
    menuTemplateId: row.menu_template_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fromDbStallWithDetails(row: any): StallWithDetails {
  return {
    ...fromDbStall(row),
    eventName: row.events?.name ?? '',
    eventCode: row.events?.code ?? '',
    startDate: row.events?.start_date ?? '',
    endDate: row.events?.end_date ?? '',
    eventStatus: row.events?.status ?? 'ACTIVE',
    boothInfo: row.booth_info ?? null,
  };
}
