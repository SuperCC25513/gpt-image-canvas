import type { CurrentUser } from "./auth.js";
import type { CreditTransaction } from "./credits.js";

export const REDEMPTION_CODE_STATUSES = ["active", "disabled"] as const;
export type RedemptionCodeStatus = (typeof REDEMPTION_CODE_STATUSES)[number];

export const REDEMPTION_CODE_PREFIX = "CC";
export const REDEMPTION_CODE_MIN_CREDITS = 1;
export const REDEMPTION_CODE_MAX_CREDITS = 10_000;
export const REDEMPTION_CODE_MIN_CREATE_COUNT = 1;
export const REDEMPTION_CODE_MAX_CREATE_COUNT = 200;

export interface RedemptionCodeSummary {
  id: string;
  code: string;
  credits: number;
  status: RedemptionCodeStatus;
  expiresAt?: string;
  redeemedByUserId?: string;
  redeemedByUserName?: string;
  redeemedByUserEmail?: string;
  redeemedAt?: string;
  createdByAdminId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionCodeListResponse {
  items: RedemptionCodeSummary[];
}

export interface AdminCreateRedemptionCodesRequest {
  credits: number;
  count: number;
  expiresAt?: string;
}

export interface AdminCreateRedemptionCodesResponse {
  items: RedemptionCodeSummary[];
}

export interface AdminUpdateRedemptionCodeRequest {
  status: RedemptionCodeStatus;
}

export interface AdminDeleteRedemptionCodeResponse {
  ok: true;
  id: string;
}

export interface RedeemCreditCodeRequest {
  code: string;
}

export interface CreditRedemptionSummary {
  codeId: string;
  codeShort: string;
  creditsAwarded: number;
  redeemedAt: string;
}

export interface RedeemCreditCodeResponse {
  user: CurrentUser;
  transaction: CreditTransaction;
  redemption: CreditRedemptionSummary;
}
