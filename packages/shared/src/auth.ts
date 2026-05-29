import type { CheckinStatus } from "./credits.js";

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "pending", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS = [
  "126.com",
  "139.com",
  "163.com",
  "189.cn",
  "aliyun.com",
  "gmail.com",
  "qq.com"
] as const;

const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export function normalizeRegistrationEmailDomain(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  const domain = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!domain || domain.length > 253) {
    return undefined;
  }

  const labels = domain.split(".");
  if (labels.length < 2) {
    return undefined;
  }
  if (labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))) {
    return undefined;
  }

  return domain;
}

export function normalizeAllowedRegistrationEmailDomains(input: readonly string[]): string[] | undefined {
  const domains: string[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (item.trim().length === 0) {
      continue;
    }

    const domain = normalizeRegistrationEmailDomain(item);
    if (!domain) {
      return undefined;
    }
    if (!seen.has(domain)) {
      domains.push(domain);
      seen.add(domain);
    }
  }

  return domains;
}

export function parseAllowedRegistrationEmailDomainsJson(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [...DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      return [...DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS];
    }

    return normalizeAllowedRegistrationEmailDomains(parsed) ?? [...DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS];
  } catch {
    return [...DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS];
  }
}

export function isRegistrationEmailDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) {
    return true;
  }

  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) {
    return false;
  }

  const domain = normalizeRegistrationEmailDomain(email.slice(atIndex + 1));
  return domain ? allowedDomains.includes(domain) : false;
}

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
  generationCreditCost: number;
  checkinCredit: number;
  maxImagesPerRequest: number;
  allowedRegistrationEmailDomains: string[];
  adminConfigured: boolean;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: CurrentUser;
  settings: AuthSettings;
  checkin?: CheckinStatus;
}

export interface AuthSessionResponse {
  user: CurrentUser;
}

export interface AuthPendingRegistrationResponse {
  status: "pending";
  message: string;
}

export type AuthRegisterResponse = AuthSessionResponse | AuthPendingRegistrationResponse;

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  emailVerificationCode: string;
}

export interface RegisterEmailVerificationRequest {
  email: string;
  locale?: "zh-CN" | "en";
}

export interface RegisterEmailVerificationResponse {
  ok: true;
  expiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export type AuthErrorCode =
  | "account_inactive"
  | "email_already_registered"
  | "email_verification_expired"
  | "email_verification_invalid"
  | "email_verification_rate_limited"
  | "email_verification_required"
  | "email_verification_unavailable"
  | "forbidden"
  | "email_domain_not_allowed"
  | "invalid_auth_request"
  | "invalid_credentials"
  | "generation_limit_exceeded"
  | "insufficient_credits"
  | "registration_disabled"
  | "unauthorized";
