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

type AdminJwtPayload = {
  userId: string;
  email: string;
  role: 'admin';
};

type AppJwtPayload = VendorOrganizerJwtPayload | CustomerJwtPayload | AdminJwtPayload;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AppJwtPayload;
    user: AppJwtPayload;
  }
}
