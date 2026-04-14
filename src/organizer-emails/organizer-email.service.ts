import { supabase } from '../lib/supabase.js';
import { sendEmail } from '../lib/email.js';

const ORGANIZER_APP_URL = process.env.ORGANIZER_APP_URL || 'https://nownow-organizer.vercel.app';

/**
 * Look up an organizer's email from the organizer_users table.
 */
export async function getOrganizerEmail(organizerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('organizer_users')
    .select('email')
    .eq('id', organizerId)
    .single();

  if (error || !data) return null;
  return data.email;
}

/**
 * Process scheduled organizer emails: 24h reminders and event ended recaps.
 * Called hourly by QStash.
 */
export async function processOrganizerEmails(): Promise<{ reminders: number; recaps: number }> {
  const now = new Date();
  let reminders = 0;
  let recaps = 0;

  // ── 24h Event Reminders ──
  const reminderWindow = new Date(now.getTime() + 25 * 60 * 60 * 1000); // now + 25h
  const { data: upcomingEvents } = await supabase
    .from('events')
    .select('id, name, start_date, end_date, organizer_id, code')
    .eq('origin_type', 'organizer')
    .eq('status', 'ACTIVE')
    .is('reminder_sent_at', null)
    .gte('start_date', now.toISOString())
    .lte('start_date', reminderWindow.toISOString());

  for (const event of upcomingEvents || []) {
    if (!event.organizer_id) continue;
    const email = await getOrganizerEmail(event.organizer_id);
    if (!email) continue;

    // Count accepted vendors
    const { count: vendorCount } = await supabase
      .from('event_vendors')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('status', 'accepted');

    const startDate = new Date(event.start_date);
    const hoursUntil = Math.round((startDate.getTime() - now.getTime()) / (1000 * 60 * 60));

    try {
      await sendEmail({
        to: email,
        subject: `Your event "${event.name}" starts tomorrow`,
        html: `
          <h2>Event Reminder</h2>
          <p>Your event <strong>${event.name}</strong> starts in approximately <strong>${hoursUntil} hours</strong>.</p>
          <p><strong>Vendors confirmed:</strong> ${vendorCount || 0}</p>
          <p><a href="${ORGANIZER_APP_URL}/events/${event.id}">View event details</a></p>
        `,
      });

      await supabase
        .from('events')
        .update({ reminder_sent_at: now.toISOString() })
        .eq('id', event.id);

      reminders++;
    } catch (err: any) {
      console.error(`Failed to send reminder for event ${event.id}:`, err?.message);
    }
  }

  // ── Event Ended Recaps ──
  const recapWindowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000); // now - 2h
  const { data: endedEvents } = await supabase
    .from('events')
    .select('id, name, start_date, end_date, organizer_id')
    .eq('origin_type', 'organizer')
    .eq('status', 'ACTIVE')
    .is('recap_sent_at', null)
    .gte('end_date', recapWindowStart.toISOString())
    .lte('end_date', now.toISOString());

  for (const event of endedEvents || []) {
    if (!event.organizer_id) continue;
    const email = await getOrganizerEmail(event.organizer_id);
    if (!email) continue;

    // Aggregate order stats
    const { data: orderStats } = await supabase
      .from('orders')
      .select('total, vendor_id, status')
      .eq('event_id', event.id)
      .in('payment_status', ['complete', 'pay_at_stall']);

    const orders = orderStats || [];
    const totalOrders = orders.filter(o => o.status !== 'CANCELLED').length;
    const totalRevenue = orders
      .filter(o => o.status !== 'CANCELLED')
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    // Find top vendor
    const vendorRevenue = new Map<string, number>();
    for (const o of orders) {
      if (o.status === 'CANCELLED') continue;
      vendorRevenue.set(o.vendor_id, (vendorRevenue.get(o.vendor_id) || 0) + (Number(o.total) || 0));
    }
    let topVendorId = '';
    let topRevenue = 0;
    for (const [vid, rev] of vendorRevenue) {
      if (rev > topRevenue) { topVendorId = vid; topRevenue = rev; }
    }

    let topVendorName = '';
    if (topVendorId) {
      const { data: vendor } = await supabase
        .from('vendors')
        .select('name')
        .eq('id', topVendorId)
        .single();
      topVendorName = vendor?.name || 'Unknown';
    }

    const uniqueVendors = new Set(orders.map(o => o.vendor_id)).size;

    try {
      await sendEmail({
        to: email,
        subject: `Event recap: "${event.name}"`,
        html: `
          <h2>Event Recap</h2>
          <p>Your event <strong>${event.name}</strong> has ended. Here's a summary:</p>
          <table style="border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold;">Total Orders</td><td>${totalOrders}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold;">Total Revenue</td><td>R${totalRevenue.toFixed(2)}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold;">Vendors</td><td>${uniqueVendors}</td></tr>
            ${topVendorName ? `<tr><td style="padding:4px 16px 4px 0;font-weight:bold;">Top Vendor</td><td>${topVendorName} (R${topRevenue.toFixed(2)})</td></tr>` : ''}
          </table>
          <p><a href="${ORGANIZER_APP_URL}/settlements/${event.id}">View settlement details</a></p>
        `,
      });

      await supabase
        .from('events')
        .update({ recap_sent_at: now.toISOString() })
        .eq('id', event.id);

      recaps++;
    } catch (err: any) {
      console.error(`Failed to send recap for event ${event.id}:`, err?.message);
    }
  }

  return { reminders, recaps };
}
