import type { CurrentUser } from "./auth.js";

export const DEFAULT_REGISTRATION_CREDITS = 10;
export const DEFAULT_GENERATION_CREDIT_COST = 1;
export const DEFAULT_CHECKIN_CREDIT = 1;
export const DEFAULT_MAX_IMAGES_PER_REQUEST = 16;

export const CREDIT_TRANSACTION_REASONS = [
  "registration_bonus",
  "daily_checkin",
  "generation_charge",
  "generation_refund",
  "admin_adjustment"
] as const;

export type CreditTransactionReason = (typeof CREDIT_TRANSACTION_REASONS)[number];

export interface CreditTransaction {
  id: string;
  userId: string;
  delta: number;
  reason: CreditTransactionReason;
  relatedGenerationId?: string;
  relatedOutputId?: string;
  relatedCheckinDate?: string;
  adminNote?: string;
  createdAt: string;
}

export interface CreditTransactionListResponse {
  items: CreditTransaction[];
  nextCursor?: string;
}

export interface CheckinStatus {
  checkedInToday: boolean;
  checkinDate: string;
  creditAward: number;
}

export interface CheckinResponse {
  user: CurrentUser;
  checkin: CheckinStatus;
  transaction?: CreditTransaction;
}
