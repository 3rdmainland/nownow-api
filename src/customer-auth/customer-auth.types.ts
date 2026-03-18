export interface RequestOtpPayload {
  phone: string;
}

export interface VerifyOtpPayload {
  phone: string;
  code: string;
}

export interface CustomerJwtPayload {
  customerId: string;
  phone: string;
  role: 'customer';
}

export interface Customer {
  id: string;
  phone: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface OtpData {
  code: string;
  attempts: number;
}

export interface UpdateProfilePayload {
  name: string;
}
