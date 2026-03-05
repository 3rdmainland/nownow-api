import { FastifyPluginAsync } from 'fastify';
import { uploadImage } from './upload.service.js';
import { ImagePurpose } from './upload.types.js';
import { authenticate } from '../lib/auth.js';

interface UploadBody {
    file: string;     // base64-encoded image data
    mimetype: string; // e.g. "image/jpeg"
}

const uploadController: FastifyPluginAsync = async (fastify) => {
    // POST /upload/event/:eventId
    fastify.post<{
        Params: { eventId: string };
        Querystring: { purpose: ImagePurpose };
        Body: UploadBody;
    }>('/event/:eventId', {
        bodyLimit: 10 * 1024 * 1024, // 10 MB (base64 adds ~33% overhead)
    }, async (request, reply) => {
        const { eventId } = request.params;
        const { purpose } = request.query;
        const { file, mimetype } = request.body;

        if (!file) return reply.status(400).send({ error: 'No file uploaded' });

        const buffer = Buffer.from(file, 'base64');
        const result = await uploadImage(buffer, mimetype, eventId, purpose);
        return reply.send(result);
    });

    // POST /upload/vendor/:vendorId
    fastify.post<{
        Params: { vendorId: string };
        Querystring: { purpose: ImagePurpose };
        Body: UploadBody;
    }>('/vendor/:vendorId', {
        preHandler: [authenticate],
        bodyLimit: 10 * 1024 * 1024,
    }, async (request, reply) => {
        const { vendorId } = request.params;
        const { purpose } = request.query;
        const { file, mimetype } = request.body;

        if (!file) return reply.status(400).send({ error: 'No file uploaded' });

        const buffer = Buffer.from(file, 'base64');
        const result = await uploadImage(buffer, mimetype, vendorId, purpose);
        return reply.send(result);
    });

    // POST /upload/menu/:vendorId
    fastify.post<{
        Params: { vendorId: string };
        Querystring: { purpose: ImagePurpose };
        Body: UploadBody;
    }>('/menu/:vendorId', {
        preHandler: [authenticate],
        bodyLimit: 10 * 1024 * 1024,
    }, async (request, reply) => {
        const { vendorId } = request.params;
        const { purpose } = request.query;
        const { file, mimetype } = request.body;

        if (!file) return reply.status(400).send({ error: 'No file uploaded' });

        const buffer = Buffer.from(file, 'base64');
        const result = await uploadImage(buffer, mimetype, vendorId, purpose);
        return reply.send(result);
    });
};

export default uploadController;
