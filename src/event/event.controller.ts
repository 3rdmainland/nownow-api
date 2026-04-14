import { FastifyPluginAsync } from "fastify";
import {
    getEventsResponseSchema,
    getEventByIdResponseSchema,
    getEventByCodeResponseSchema,
    createEventSchema,
    updateEventSchema,
    deleteEventSchema,
    getEventsByVendorSchema,
    addVendorsToEventSchema,
    removeVendorFromEventSchema,
    getEventVendorStatusesSchema,
} from "./event.schema";
import { EventService } from "./event.service";
import { supabase } from "../lib/supabase.js";
import { notifyVendorUser, notifyOrganizer } from "../notifications/notify-helpers.js";
import { authenticate, authenticateAdmin, authenticateOrganizerOrAdmin, assertOrganizerOwnsEvent } from "../lib/auth.js";

const eventController: FastifyPluginAsync = async (fastify) => {
    const eventService = new EventService();

    fastify.get("/", { schema: getEventsResponseSchema }, async (request, reply) => {
        try {
            const events = await eventService.getAllEvents();
            return { events };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.get<{ Params: { code: string } }>("/code/:code", { schema: getEventByCodeResponseSchema }, async (request, reply) => {
        try {
            const event = await eventService.getEventByCode(request.params.code);
            if (!event) return reply.status(404).send({ error: "Event not found" });
            return { event };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.get<{ Params: { id: string } }>("/:id", { schema: getEventByIdResponseSchema }, async (request, reply) => {
        try {
            const event = await eventService.getEventById(request.params.id);
            if (!event) return reply.status(404).send({ error: "Event not found" });
            return { event };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.post("/", { schema: createEventSchema, preHandler: [authenticateOrganizerOrAdmin] }, async (request, reply) => {
        try {
            const eventData = request.body as any;
            const user = request.user as { userId?: string; role?: string };
            if (user?.role === 'organizer' && user.userId) {
                eventData.organizerId = user.userId;
            }
            const event = await eventService.createEvent(eventData);

            // Fire-and-forget: send event created confirmation email
            if (user?.role === 'organizer' && user.userId) {
                (async () => {
                    try {
                        const { getOrganizerEmail } = await import('../organizer-emails/organizer-email.service.js');
                        const { sendEmail } = await import('../lib/email.js');
                        const email = await getOrganizerEmail(user.userId!);
                        if (email) {
                            const ORGANIZER_APP_URL = process.env.ORGANIZER_APP_URL || 'https://nownow-organizer.vercel.app';
                            const startDate = new Date(event.startDate).toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                            await sendEmail({
                                to: email,
                                subject: `Your event "${event.name}" has been created`,
                                html: `
                                    <h2>Event Created</h2>
                                    <p>Your event <strong>${event.name}</strong> has been created successfully.</p>
                                    <p><strong>Start:</strong> ${startDate}</p>
                                    <p><strong>Event Code:</strong> ${event.code}</p>
                                    <p><a href="${ORGANIZER_APP_URL}/events/${event.id}">View your event</a></p>
                                `,
                            });
                        }
                    } catch { /* notification email errors should never fail the request */ }
                })();
            }

            return reply.status(201).send({ event });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.patch<{ Params: { id: string } }>("/:id", { schema: updateEventSchema, preHandler: [authenticateOrganizerOrAdmin] }, async (request, reply) => {
        try {
            const { id } = request.params;
            await assertOrganizerOwnsEvent(request, id);
            const updates = request.body as any;
            const event = await eventService.updateEvent(id, updates);
            return { event };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.delete<{ Params: { id: string } }>("/:id", { schema: deleteEventSchema, preHandler: [authenticateAdmin] }, async (request, reply) => {
        try {
            await eventService.deleteEvent(request.params.id);
            return reply.status(204).send();
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.post<{ Params: { id: string } }>("/:id/vendors", { schema: addVendorsToEventSchema, preHandler: [authenticateOrganizerOrAdmin] }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { invites } = request.body as { invites: { vendorId: string; commissionRate: number }[] };
            // Get organizer ID from JWT
            let organizerId: string | undefined;
            try {
                await request.jwtVerify();
                const user = request.user as { userId?: string; role?: string };
                if (user?.role === 'organizer' && user.userId) {
                    organizerId = user.userId;
                }
            } catch {
                // no JWT
            }
            if (!organizerId) {
                return reply.status(401).send({ error: 'Authentication required' });
            }
            await eventService.inviteVendorsToEvent(id, organizerId, invites);

            // Fire-and-forget notifications (don't block the response)
            const vendorIds = invites.map(inv => inv.vendorId);
            (async () => {
                try {
                    const [event, { data: vendorUsers }] = await Promise.all([
                        eventService.getEventById(id),
                        supabase
                            .from('vendor_users')
                            .select('id, vendor_id')
                            .in('vendor_id', vendorIds)
                            .eq('is_active', true),
                    ]);
                    const eventName = event?.name || 'an event';

                    for (const vu of vendorUsers || []) {
                        notifyVendorUser(vu.vendor_id, vu.id, {
                            title: 'New Event Invitation',
                            message: `You've been invited to "${eventName}". Check your agreements to accept.`,
                            type: 'action',
                            actionUrl: '/account/agreements',
                        });
                    }

                    notifyOrganizer(organizerId!, {
                        title: 'Vendor Invitations Sent',
                        message: `${invites.length} vendor(s) invited to "${eventName}".`,
                        type: 'success',
                        actionUrl: `/events/${id}`,
                    });
                } catch { /* notification errors should never fail the request */ }
            })();

            return reply.status(204).send();
        } catch (err: any) {
            fastify.log.error(err);
            if (err.statusCode === 400 || err.name === 'ValidationError') {
                return reply.status(400).send({ error: err.message });
            }
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.get<{ Params: { id: string } }>("/:id/vendors/statuses", { schema: getEventVendorStatusesSchema, preHandler: [authenticateOrganizerOrAdmin] }, async (request, reply) => {
        try {
            await assertOrganizerOwnsEvent(request, request.params.id);
            const statuses = await eventService.getEventVendorStatuses(request.params.id);
            return { statuses };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.delete<{ Params: { id: string; vendorId: string } }>("/:id/vendors/:vendorId", { schema: removeVendorFromEventSchema, preHandler: [authenticateOrganizerOrAdmin] }, async (request, reply) => {
        try {
            const { id, vendorId } = request.params;
            await assertOrganizerOwnsEvent(request, id);
            await eventService.removeVendorFromEvent(id, vendorId);
            return reply.status(204).send();
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.get<{ Params: { vendorId: string }; Querystring: { active?: string } }>("/vendor/:vendorId", { schema: getEventsByVendorSchema }, async (request, reply) => {
        try {
            const activeOnly = request.query.active === 'true';
            const events = await eventService.getEventsByVendorId(request.params.vendorId, activeOnly);
            return { events };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });
};

export default eventController;
