export type VendorRole = 'owner' | 'manager' | 'staff';

export interface VendorUserRole {
  id: string;
  userId: string;
  vendorId: string;
  role: VendorRole;
  createdAt: string;
  updatedAt: string;
}

export interface VendorRoleSummary {
  vendorId: string;
  vendorName: string;
  role: VendorRole;
  logoUrl: string | null;
}

export interface StaffMember {
  id: string;
  userId: string;
  email: string;
  role: VendorRole;
  createdAt: string;
}

export interface StaffInvite {
  id: string;
  vendorId: string;
  invitedBy: string;
  email: string;
  role: VendorRole;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface InviteStaffDto {
  email: string;
  role: 'manager' | 'staff';
}

export interface UpdateStaffRoleDto {
  role: 'manager' | 'staff';
}
