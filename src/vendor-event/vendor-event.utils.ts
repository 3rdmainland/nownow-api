import { VendorEvent, VendorEventWithDetails } from './vendor-event.types.js';

export function fromDbVendorEvent(row: any): VendorEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    vendorId: row.vendor_id,
    qrCode: row.qr_code,
    qrImage: row.qr_image,
    menuTemplateId: row.menu_template_id ?? null,
    isDirect: row.is_direct,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fromDbVendorEventWithDetails(row: any): VendorEventWithDetails {
  return {
    ...fromDbVendorEvent(row),
    eventName: row.events?.name ?? '',
    eventCode: row.events?.code ?? '',
    startDate: row.events?.start_date ?? '',
    endDate: row.events?.end_date ?? '',
    status: row.events?.status ?? 'ACTIVE',
  };
}
