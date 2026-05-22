import type { CurrentUser, UserRole, UserStatus } from "./auth.js";
import type { CreditTransaction } from "./credits.js";
import type { GeneratedAsset } from "./generation.js";
import type { GenerationStatus, ImageMode, OutputStatus } from "./image.js";

export interface AdminUserSummary extends CurrentUser {}

export interface AdminUsersResponse {
  users: AdminUserSummary[];
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
}
