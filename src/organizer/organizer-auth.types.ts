export interface OrganizerLoginPayload {
  email: string;
  password: string;
}

export interface OrganizerRegisterPayload {
  token: string;
  password: string;
  name: string;
}

export interface OrganizerInvitePayload {
  email: string;
}

export interface OrganizerJwtPayload {
  userId: string;
  email: string;
  role: 'organizer';
}

export interface OrganizerUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  organization: string | null;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export type SafeOrganizerUser = Omit<OrganizerUser, 'passwordHash'>;

export interface OrganizerUpdateProfilePayload {
  name?: string;
  phone?: string;
  organization?: string;
}
