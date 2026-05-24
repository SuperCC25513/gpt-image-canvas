import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Coins,
  Loader2,
  RefreshCw,
  Sparkles,
  WalletCards
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AuthMeResponse,
  CreditTransaction,
  CreditTransactionReason
} from "@gpt-image-canvas/shared";
import { useI18n, type Translate } from "../../shared/i18n";
import {
  isCreditTransactionListResponse,
  readApiErrorMessage
} from "../../shared/api/generation";

interface CreditCenterPageProps {
  accountError: string;
  accountStatus: AuthMeResponse | null;
  isAccountLoading: boolean;
  isCheckingIn: boolean;
  onCheckin: () => Promise<void>;
  onOpenGenerate: () => void;
  onRefreshAccountStatus: (signal?: AbortSignal) => Promise<AuthMeResponse | null>;
}

export function CreditCenterPage({
  accountError,
  accountStatus,
  isAccountLoading,
  isCheckingIn,
  onCheckin,
  onOpenGenerate,
  onRefreshAccountStatus
}: CreditCenterPageProps) {
  const { locale, t, formatDateTime } = useI18n();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [isTransactionsLoading, setIsTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const accountUser = accountStatus?.authenticated ? accountStatus.user : undefined;
  const checkinStatus = accountStatus?.checkin;
  const creditAward = checkinStatus?.creditAward ?? accountStatus?.settings.checkinCredit ?? 0;
  const checkedInToday = checkinStatus?.checkedInToday === true;
  const canCheckin = Boolean(accountUser) && !checkedInToday && !isCheckingIn && !isAccountLoading;
  const balance = accountUser?.credits ?? 0;
  const generationCost = accountStatus?.settings.generationCreditCost ?? 0;
  const maxImages = accountStatus?.settings.maxImagesPerRequest ?? 0;
  const latestTransaction = transactions[0];
  const positiveTransactionCount = useMemo(
    () => transactions.filter((transaction) => transaction.delta > 0).length,
    [transactions]
  );

  const loadTransactions = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setIsTransactionsLoading(true);
    setTransactionsError("");

    try {
      const response = await fetch("/api/credits/transactions?limit=30", {
        credentials: "same-origin",
        signal
      });
      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, locale, t("creditsTransactionsRequestFailed", { status: response.status }))
        );
      }

      const body = (await response.json()) as unknown;
      if (!isCreditTransactionListResponse(body)) {
        throw new Error(t("creditsTransactionsInvalidData"));
      }

      if (!signal?.aborted) {
        setTransactions(body.items);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setTransactionsError(error instanceof Error ? error.message : t("creditsTransactionsLoadFailed"));
      }
    } finally {
      if (!signal?.aborted) {
        setIsTransactionsLoading(false);
      }
    }
  }, [locale, t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTransactions(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadTransactions]);

  async function refreshCreditCenter(): Promise<void> {
    setStatusMessage("");
    await Promise.all([onRefreshAccountStatus(), loadTransactions()]);
    setStatusMessage(t("creditsCenterRefreshed"));
  }

  async function handleCheckin(): Promise<void> {
    setStatusMessage("");
    await onCheckin();
    await Promise.all([onRefreshAccountStatus(), loadTransactions()]);
    setStatusMessage(t("creditsCenterCheckinSynced"));
  }

  return (
    <main className="credits-page app-view" data-testid="credits-page">
      <div className="credits-page__inner">
        <header className="credits-page__header">
          <div className="credits-page__title-block">
            <span className="credits-page__eyebrow">
              <WalletCards className="size-4" aria-hidden="true" />
              {t("creditsCenterEyebrow")}
            </span>
            <h1>{t("creditsCenterTitle")}</h1>
            <p>{t("creditsCenterSubtitle")}</p>
          </div>
          <div className="credits-page__toolbar">
            <button
              className="credits-page__ghost-action"
              disabled={isAccountLoading || isTransactionsLoading}
              type="button"
              onClick={() => void refreshCreditCenter()}
            >
              {isAccountLoading || isTransactionsLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              {t("creditsCenterRefresh")}
            </button>
            <button className="credits-page__primary-action" type="button" onClick={onOpenGenerate}>
              <Sparkles className="size-4" aria-hidden="true" />
              {t("creditsCenterOpenGenerate")}
            </button>
          </div>
        </header>

        <section className="credits-page__overview" aria-label={t("creditsCenterOverviewAria")}>
          <div className="credits-stat credits-stat--balance">
            <span className="credits-stat__icon">
              <Coins className="size-5" aria-hidden="true" />
            </span>
            <div className="credits-stat__body">
              <span>{t("creditsCenterBalanceTitle")}</span>
              <strong>{isAccountLoading ? t("commonNotSet") : balance}</strong>
              <p>{t("creditsCenterBalanceHint", { cost: generationCost, max: maxImages })}</p>
            </div>
          </div>

          <div className="credits-stat">
            <span className="credits-stat__icon credits-stat__icon--teal">
              <CalendarCheck className="size-5" aria-hidden="true" />
            </span>
            <div className="credits-stat__body">
              <span>{t("creditsCenterCheckinTitle")}</span>
              <strong>{checkedInToday ? t("creditsCheckinDoneCompact") : t("creditsCenterCheckinReady")}</strong>
              <p>
                {checkedInToday
                  ? t("creditsCenterCheckinDoneCopy")
                  : accountUser
                    ? t("creditsCenterCheckinAward", { credits: creditAward })
                    : t("creditsCenterCheckinUnavailable")}
              </p>
            </div>
            <button
              className="credits-stat__action"
              data-state={checkedInToday ? "done" : "available"}
              disabled={!canCheckin}
              type="button"
              onClick={() => void handleCheckin()}
            >
              {isCheckingIn ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : checkedInToday ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <CalendarCheck className="size-4" aria-hidden="true" />
              )}
              {isCheckingIn ? t("creditsCheckinLoading") : checkedInToday ? t("creditsCheckinDone") : t("creditsCheckin")}
            </button>
          </div>

          <div className="credits-stat">
            <span className="credits-stat__icon credits-stat__icon--ink">
              <RefreshCw className="size-5" aria-hidden="true" />
            </span>
            <div className="credits-stat__body">
              <span>{t("creditsCenterLatestTitle")}</span>
              <strong>{latestTransaction ? transactionDeltaLabel(latestTransaction, t) : t("commonNotRecorded")}</strong>
              <p>
                {latestTransaction
                  ? `${creditTransactionReasonLabel(latestTransaction.reason, t)} · ${formatDateTime(latestTransaction.createdAt)}`
                  : t("creditsCenterLatestEmpty")}
              </p>
            </div>
          </div>
        </section>

        {accountError || transactionsError || statusMessage ? (
          <div
            className="credits-page__notice"
            data-tone={accountError || transactionsError ? "error" : "success"}
            role={accountError || transactionsError ? "alert" : "status"}
          >
            {accountError || transactionsError ? <AlertTriangle className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            <span>{accountError || transactionsError || statusMessage}</span>
          </div>
        ) : null}

        <section className="credits-ledger" aria-labelledby="credits-ledger-title">
          <div className="credits-ledger__header">
            <div>
              <h2 id="credits-ledger-title">{t("creditsTransactionsTitle")}</h2>
              <p>{t("creditsTransactionsSubtitle", { count: transactions.length, gains: positiveTransactionCount })}</p>
            </div>
          </div>

          {isTransactionsLoading ? (
            <div className="credits-ledger__state" role="status">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              <span>{t("creditsTransactionsLoading")}</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="credits-ledger__state">
              <WalletCards className="size-6" aria-hidden="true" />
              <strong>{t("creditsTransactionsEmptyTitle")}</strong>
              <span>{t("creditsTransactionsEmptyHint")}</span>
            </div>
          ) : (
            <ol className="credits-ledger__list">
              {transactions.map((transaction) => (
                <li className="credits-ledger__item" data-tone={transaction.delta >= 0 ? "gain" : "spend"} key={transaction.id}>
                  <div className="credits-ledger__item-main">
                    <span className="credits-ledger__reason">{creditTransactionReasonLabel(transaction.reason, t)}</span>
                    <span className="credits-ledger__time">{formatDateTime(transaction.createdAt)}</span>
                    <TransactionDetails transaction={transaction} t={t} />
                  </div>
                  <strong className="credits-ledger__delta">{transactionDeltaLabel(transaction, t)}</strong>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}

function TransactionDetails({ transaction, t }: { transaction: CreditTransaction; t: Translate }) {
  const details = transactionDetails(transaction, t);
  if (details.length === 0) {
    return null;
  }

  return (
    <ul className="credits-ledger__details">
      {details.map((detail) => (
        <li key={detail}>{detail}</li>
      ))}
    </ul>
  );
}

function transactionDetails(transaction: CreditTransaction, t: Translate): string[] {
  const details: string[] = [];
  if (transaction.relatedGenerationId) {
    details.push(t("creditsTransactionRelatedGeneration", { id: shortIdentifier(transaction.relatedGenerationId) }));
  }
  if (transaction.relatedOutputId) {
    details.push(t("creditsTransactionRelatedOutput", { id: shortIdentifier(transaction.relatedOutputId) }));
  }
  if (transaction.relatedCheckinDate) {
    details.push(t("creditsTransactionRelatedCheckin", { date: transaction.relatedCheckinDate }));
  }
  if (transaction.adminNote) {
    details.push(t("creditsTransactionAdminNote", { note: transaction.adminNote }));
  }
  return details;
}

function transactionDeltaLabel(transaction: CreditTransaction, t: Translate): string {
  const credits = Math.abs(transaction.delta);
  return transaction.delta >= 0
    ? t("creditsTransactionDeltaGain", { credits })
    : t("creditsTransactionDeltaSpend", { credits });
}

function creditTransactionReasonLabel(reason: CreditTransactionReason, t: Translate): string {
  switch (reason) {
    case "registration_bonus":
      return t("creditsReasonRegistrationBonus");
    case "daily_checkin":
      return t("creditsReasonDailyCheckin");
    case "generation_charge":
      return t("creditsReasonGenerationCharge");
    case "generation_refund":
      return t("creditsReasonGenerationRefund");
    case "admin_adjustment":
      return t("creditsReasonAdminAdjustment");
  }
}

function shortIdentifier(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value;
}
