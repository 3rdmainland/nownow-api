import '@fastify/jwt';
import '@fastify/cookie';

type VendorOrganizerJwtPayload = {
  userId: string;
  email: string;
  vendorId?: string;
  role?: 'organizer' | 'vendor';
};

type CustomerJwtPayload = {
  customerId: string;
  phone: string;
  role: 'customer';
};

type AppJwtPayload = VendorOrganizerJwtPayload | CustomerJwtPayload;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AppJwtPayload;
    user: AppJwtPayload;
  }
}
