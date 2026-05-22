export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "pending", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSettings {
  allowRegistration: boolean;
  requireApproval: boolean;
  defaultCredits: number;
  adminConfigured: boolean;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: CurrentUser;
  settings: AuthSettings;
}

export interface AuthSessionResponse {
  user: CurrentUser;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export type AuthErrorCode =
  | "account_inactive"
  | "email_already_registered"
  | "forbidden"
  | "invalid_auth_request"
  | "invalid_credentials"
  | "registration_disabled"
  | "unauthorized";
