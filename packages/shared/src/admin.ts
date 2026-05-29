import type { CurrentUser, UserRole, UserStatus } from "./auth.js";
import type { CreditTransaction } from "./credits.js";
import type { GeneratedAsset } from "./generation.js";
import type { GenerationStatus, ImageMode, OutputStatus } from "./image.js";

export interface AdminUserSummary extends CurrentUser {}

export interface AdminUsersResponse {
  users: AdminUserSummary[];
  nextCursor?: string;
}

export interface AdminUserUpdateRequest {
  role?: UserRole;
  status?: UserStatus;
}

export interface AdminUserResponse {
  user: AdminUserSummary;
}

export type AdminCreditAdjustmentMode = "set" | "delta";

export interface AdminCreditAdjustmentRequest {
  mode: AdminCreditAdjustmentMode;
  amount: number;
  note?: string;
}

export interface AdminCreditAdjustmentResponse {
  user: AdminUserSummary;
  transaction: CreditTransaction;
}

export interface AdminSettings {
  allowRegistration: boolean;
  requireApproval: boolean;
  defaultCredits: number;
  generationCreditCost: number;
  checkinCredit: number;
  maxImagesPerRequest: number;
  allowedRegistrationEmailDomains: string[];
}

export type AdminSettingsUpdateRequest = Partial<AdminSettings>;

export interface AdminSettingsResponse {
  settings: AdminSettings;
}

export interface AdminGenerationAuditUser {
  id: string;
  name: string;
  email: string;
}

export interface AdminGenerationAuditOutput {
  outputId: string;
  status: OutputStatus;
  asset?: GeneratedAsset;
  error?: string;
  isPublic: boolean;
}

export interface AdminGenerationAuditRecord {
  id: string;
  generationId: string;
  user?: AdminGenerationAuditUser;
  mode: ImageMode;
  prompt: string;
  isPublic: boolean;
  status: GenerationStatus;
  errorSummary?: string;
  ipAddress?: string;
  userAgent?: string;
  outputs: AdminGenerationAuditOutput[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminGenerationAuditsResponse {
  items: AdminGenerationAuditRecord[];
  nextCursor?: string;
}

export type AdminGenerationQueueDriver = "redis" | "inline";
export type AdminRedisStatus = "ok" | "disabled" | "unavailable";

export interface AdminGenerationQueueRuntime {
  driver: AdminGenerationQueueDriver;
  readyLength?: number;
  workerRunning: boolean;
  activeWorkers: number;
  workerConcurrency: number;
  pollIntervalMs: number;
}

export interface AdminProviderSchedulerRuntime {
  configuredConcurrency: number;
  activePermits?: number;
  availablePermits?: number;
  permitTtlMs: number;
}

export interface AdminProviderRetrySummary {
  maxRetries: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type AdminGenerationQueueFailureStatus = Extract<GenerationStatus, "failed" | "partial" | "cancelled">;

export interface AdminGenerationQueueRecentFailure {
  generationId: string;
  status: AdminGenerationQueueFailureStatus;
  errorSummary?: string;
  updatedAt: string;
}

export interface AdminGenerationQueueDatabaseSummary {
  records: Record<GenerationStatus, number>;
  outputs: Record<OutputStatus, number>;
  recentFailures: AdminGenerationQueueRecentFailure[];
}

export interface AdminGenerationQueueStatusResponse {
  updatedAt: string;
  redis: {
    status: AdminRedisStatus;
  };
  queue: AdminGenerationQueueRuntime;
  provider: AdminProviderSchedulerRuntime;
  retry: AdminProviderRetrySummary;
  database: AdminGenerationQueueDatabaseSummary;
}
