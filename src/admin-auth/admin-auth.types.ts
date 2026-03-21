export interface AdminLoginPayload {
  email: string;
  password: string;
}

export interface AdminJwtPayload {
  userId: string;
  email: string;
  role: 'admin';
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SafeAdminUser = Omit<AdminUser, 'passwordHash'>;
