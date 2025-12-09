import { FastifyPluginAsync } from "fastify";
import {
    getEventsResponseSchema,
    getEventByIdResponseSchema,
    createEventSchema,
    updateEventSchema,
    deleteEventSchema
} from "./event.schema";
import { EventService } from "./event.service";

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

    fastify.post("/", { schema: createEventSchema }, async (request, reply) => {
        try {
            const eventData = request.body as any;
            const event = await eventService.createEvent(eventData);
            return reply.status(201).send({ event });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.patch<{ Params: { id: string } }>("/:id", { schema: updateEventSchema }, async (request, reply) => {
        try {
            const { id } = request.params;
            const updates = request.body as any;
            const event = await eventService.updateEvent(id, updates);
            return { event };
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    fastify.delete<{ Params: { id: string } }>("/:id", { schema: deleteEventSchema }, async (request, reply) => {
        try {
            await eventService.deleteEvent(request.params.id);
            return reply.status(204).send();
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: "Internal server error" });
        }
    });
};

export default eventController;
