export interface RegisterPayload {
  token: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterVendorPayload {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface InvitePayload {
  vendorId: string;
  email: string;
}

export interface JwtPayload {
  userId: string;
  vendorId: string;
  email: string;
  role: 'vendor';
}

export interface VendorUser {
  id: string;
  vendorId: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorInvite {
  id: string;
  vendorId: string;
  email: string;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export type SafeVendorUser = Omit<VendorUser, 'passwordHash'>;

export interface VendorRoleSummary {
  vendorId: string;
  vendorName: string;
  role: string;
  logoUrl: string | null;
}

export interface AuthUser {
  id: string;
  vendorId: string;
  email: string;
  createdAt: string;
  vendors: VendorRoleSummary[];
}
