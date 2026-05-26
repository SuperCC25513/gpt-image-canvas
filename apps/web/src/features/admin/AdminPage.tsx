import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Copy,
  Gift,
  KeyRound,
  Loader2,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  AdminCreditAdjustmentMode,
  AdminCreditAdjustmentResponse,
  AdminGenerationAuditRecord,
  AdminGenerationAuditsResponse,
  AdminSettings,
  AdminSettingsResponse,
  AdminUserResponse,
  AdminUserSummary,
  AdminUsersResponse,
  AdminUpdateRedemptionCodeRequest,
  CurrentUser,
  RedemptionCodeStatus,
  RedemptionCodeSummary,
  UserRole,
  UserStatus
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import {
  isAdminCreateRedemptionCodesResponse,
  isRedemptionCodeListResponse
} from "../../shared/api/generation";
import { ProviderConfigPanel, type ProviderConfigPanelProps } from "../provider-config/ProviderConfigDialog";

export type AdminTab = "users" | "redemptionCodes" | "providers" | "settings" | "audits";

interface AdminPageProps {
  activeTab: AdminTab;
  currentUser?: CurrentUser;
  onSelectTab: (tab: AdminTab) => void;
  providerConfig: Omit<ProviderConfigPanelProps, "onClose" | "variant">;
}

interface CreditFormState {
  mode: AdminCreditAdjustmentMode;
  amount: string;
  note: string;
}

interface RedemptionCodeFormState {
  credits: string;
  count: string;
  expiresAt: string;
}

const roleOptions: UserRole[] = ["user", "admin"];
const statusOptions: UserStatus[] = ["active", "pending", "disabled"];

const initialCreditForm: CreditFormState = {
  mode: "delta",
  amount: "1",
  note: ""
};

const initialRedemptionCodeForm: RedemptionCodeFormState = {
  credits: "100",
  count: "1",
  expiresAt: ""
};

const redemptionCodeExpiryPresetOptions = [
  { id: "tomorrow", labelKey: "adminRedemptionCodeExpiryTomorrow", unit: "days", amount: 1 },
  { id: "threeDays", labelKey: "adminRedemptionCodeExpiryThreeDays", unit: "days", amount: 3 },
  { id: "oneWeek", labelKey: "adminRedemptionCodeExpiryOneWeek", unit: "days", amount: 7 },
  { id: "oneMonth", labelKey: "adminRedemptionCodeExpiryOneMonth", unit: "months", amount: 1 },
  { id: "oneYear", labelKey: "adminRedemptionCodeExpiryOneYear", unit: "months", amount: 12 }
] as const;

type RedemptionCodeExpiryPresetOption = (typeof redemptionCodeExpiryPresetOptions)[number];

export function AdminPage({ activeTab, currentUser, onSelectTab, providerConfig }: AdminPageProps) {
  const { formatDateTime, locale, t } = useI18n();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [audits, setAudits] = useState<AdminGenerationAuditRecord[]>([]);
  const [redemptionCodes, setRedemptionCodes] = useState<RedemptionCodeSummary[]>([]);
  const [createdRedemptionCodes, setCreatedRedemptionCodes] = useState<RedemptionCodeSummary[]>([]);
  const [redemptionCodeForm, setRedemptionCodeForm] = useState<RedemptionCodeFormState>(initialRedemptionCodeForm);
  const [copiedRedemptionCodeId, setCopiedRedemptionCodeId] = useState("");
  const [creditForms, setCreditForms] = useState<Record<string, CreditFormState>>({});
  const [loading, setLoading] = useState({
    users: true,
    settings: true,
    audits: true,
    redemptionCodes: true
  });
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const sortedAudits = useMemo(
    () => [...audits].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [audits]
  );

  const sortedRedemptionCodes = useMemo(
    () => [...redemptionCodes].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [redemptionCodes]
  );

  const loadUsers = useCallback(
    async (query = ""): Promise<void> => {
      setLoading((value) => ({ ...value, users: true }));
      setError("");
      try {
        const params = new URLSearchParams();
        if (query.trim()) {
          params.set("q", query.trim());
        }
        params.set("limit", "100");
        const body = await adminRequest<AdminUsersResponse>(`/api/admin/users?${params.toString()}`, {
          locale,
          t
        });
        setUsers(body.users);
      } catch (requestError) {
        setError(errorMessage(requestError, t("adminUsersLoadFailed")));
      } finally {
        setLoading((value) => ({ ...value, users: false }));
      }
    },
    [locale, t]
  );

  const loadSettings = useCallback(async (): Promise<void> => {
    setLoading((value) => ({ ...value, settings: true }));
    setError("");
    try {
      const body = await adminRequest<AdminSettingsResponse>("/api/admin/settings", { locale, t });
      setSettings(body.settings);
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminSettingsLoadFailed")));
    } finally {
      setLoading((value) => ({ ...value, settings: false }));
    }
  }, [locale, t]);

  const loadAudits = useCallback(async (): Promise<void> => {
    setLoading((value) => ({ ...value, audits: true }));
    setError("");
    try {
      const body = await adminRequest<AdminGenerationAuditsResponse>("/api/admin/generation-requests?limit=200", {
        locale,
        t
      });
      setAudits(body.items);
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminAuditsLoadFailed")));
    } finally {
      setLoading((value) => ({ ...value, audits: false }));
    }
  }, [locale, t]);

  const loadRedemptionCodes = useCallback(async (): Promise<void> => {
    setLoading((value) => ({ ...value, redemptionCodes: true }));
    setError("");
    try {
      const body = await adminRequest<unknown>("/api/admin/redemption-codes?limit=200", {
        locale,
        t
      });
      if (!isRedemptionCodeListResponse(body)) {
        throw new Error(t("adminRedemptionCodesInvalidData"));
      }
      setRedemptionCodes(body.items);
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminRedemptionCodesLoadFailed")));
    } finally {
      setLoading((value) => ({ ...value, redemptionCodes: false }));
    }
  }, [locale, t]);

  useEffect(() => {
    void Promise.all([loadUsers(""), loadSettings(), loadAudits(), loadRedemptionCodes()]);
  }, [loadAudits, loadRedemptionCodes, loadSettings, loadUsers]);

  async function submitUserSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await loadUsers(userSearch);
  }

  async function updateUser(user: AdminUserSummary, patch: { role?: UserRole; status?: UserStatus }): Promise<void> {
    setBusyKey(`user:${user.id}`);
    setError("");
    setNotice("");
    try {
      const body = await adminRequest<AdminUserResponse>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        body: JSON.stringify(patch),
        locale,
        method: "PATCH",
        t
      });
      setUsers((items) => items.map((item) => (item.id === body.user.id ? body.user : item)));
      setNotice(t("adminUserSaved"));
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminUserSaveFailed")));
    } finally {
      setBusyKey("");
    }
  }

  async function adjustCredits(user: AdminUserSummary): Promise<void> {
    const form = creditForms[user.id] ?? initialCreditForm;
    const amount = Number.parseInt(form.amount, 10);
    if (!Number.isInteger(amount)) {
      setError(t("adminCreditInvalidAmount"));
      return;
    }

    setBusyKey(`credits:${user.id}`);
    setError("");
    setNotice("");
    try {
      const body = await adminRequest<AdminCreditAdjustmentResponse>(
        `/api/admin/users/${encodeURIComponent(user.id)}/credits`,
        {
          body: JSON.stringify({
            mode: form.mode,
            amount,
            note: form.note
          }),
          locale,
          method: "POST",
          t
        }
      );
      setUsers((items) => items.map((item) => (item.id === body.user.id ? body.user : item)));
      setNotice(t("adminCreditsSaved", { credits: body.user.credits }));
      setCreditForms((items) => ({
        ...items,
        [user.id]: initialCreditForm
      }));
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminCreditSaveFailed")));
    } finally {
      setBusyKey("");
    }
  }

  async function saveSettings(): Promise<void> {
    if (!settings) {
      return;
    }

    setBusyKey("settings");
    setError("");
    setNotice("");
    try {
      const body = await adminRequest<AdminSettingsResponse>("/api/admin/settings", {
        body: JSON.stringify(settings),
        locale,
        method: "PATCH",
        t
      });
      setSettings(body.settings);
      setNotice(t("adminSettingsSaved"));
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminSettingsSaveFailed")));
    } finally {
      setBusyKey("");
    }
  }

  async function createRedemptionCodes(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const credits = Number(redemptionCodeForm.credits);
    const count = Number(redemptionCodeForm.count);
    if (!Number.isInteger(credits) || !Number.isInteger(count)) {
      setError(t("adminRedemptionCodeInvalidForm"));
      return;
    }

    setBusyKey("redemption:create");
    setError("");
    setNotice("");
    try {
      const payload = {
        credits,
        count,
        expiresAt: redemptionCodeForm.expiresAt ? new Date(redemptionCodeForm.expiresAt).toISOString() : undefined
      };
      const createPromise = adminRequest<unknown>("/api/admin/redemption-codes", {
        body: JSON.stringify(payload),
        locale,
        method: "POST",
        t
      });
      const asyncClipboardWrite = count === 1 ? prepareSingleCodeClipboardWrite(createPromise) : undefined;
      const body = await createPromise;
      if (!isAdminCreateRedemptionCodesResponse(body)) {
        throw new Error(t("adminRedemptionCodesInvalidData"));
      }

      setCreatedRedemptionCodes(body.items);
      setRedemptionCodes((items) => mergeRedemptionCodes(body.items, items));
      setRedemptionCodeForm(initialRedemptionCodeForm);

      if (body.items.length === 1) {
        let copied = await finishPreparedClipboardWrite(asyncClipboardWrite);
        if (copied) {
          setCopiedRedemptionCodeId(body.items[0].id);
        } else {
          copied = await copyRedemptionCode(body.items[0]);
        }
        setNotice(copied ? t("adminRedemptionCodeCreatedSingleCopied") : t("adminRedemptionCodesCreated", { count: 1 }));
      } else {
        setNotice(t("adminRedemptionCodesCreated", { count: body.items.length }));
      }
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminRedemptionCodeCreateFailed")));
    } finally {
      setBusyKey("");
    }
  }

  function applyRedemptionCodeExpiryPreset(option: RedemptionCodeExpiryPresetOption): void {
    setRedemptionCodeForm((value) => ({
      ...value,
      expiresAt: redemptionCodeExpiryPresetValue(option)
    }));
  }

  async function updateRedemptionCodeStatus(code: RedemptionCodeSummary, status: RedemptionCodeStatus): Promise<void> {
    setBusyKey(`redemption:status:${code.id}`);
    setError("");
    setNotice("");
    try {
      const patch: AdminUpdateRedemptionCodeRequest = { status };
      const updated = await adminRequest<RedemptionCodeSummary>(`/api/admin/redemption-codes/${encodeURIComponent(code.id)}`, {
        body: JSON.stringify(patch),
        locale,
        method: "PATCH",
        t
      });
      setRedemptionCodes((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setCreatedRedemptionCodes((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(t("adminRedemptionCodeUpdated"));
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminRedemptionCodeUpdateFailed")));
    } finally {
      setBusyKey("");
    }
  }

  async function deleteRedemptionCode(code: RedemptionCodeSummary): Promise<void> {
    if (!window.confirm(t("adminRedemptionCodeDeleteConfirm", { code: code.code }))) {
      return;
    }

    setBusyKey(`redemption:delete:${code.id}`);
    setError("");
    setNotice("");
    try {
      await adminRequest<{ ok: true; id: string }>(`/api/admin/redemption-codes/${encodeURIComponent(code.id)}`, {
        locale,
        method: "DELETE",
        t
      });
      setRedemptionCodes((items) => items.filter((item) => item.id !== code.id));
      setCreatedRedemptionCodes((items) => items.filter((item) => item.id !== code.id));
      setNotice(t("adminRedemptionCodeDeleted"));
    } catch (requestError) {
      setError(errorMessage(requestError, t("adminRedemptionCodeDeleteFailed")));
    } finally {
      setBusyKey("");
    }
  }

  async function copyRedemptionCode(code: RedemptionCodeSummary): Promise<boolean> {
    setBusyKey(`redemption:copy:${code.id}`);
    setError("");
    try {
      await writeClipboardText(code.code);
      setCopiedRedemptionCodeId(code.id);
      setNotice(t("adminRedemptionCodeCopied"));
      return true;
    } catch {
      setError(t("adminRedemptionCodeCopyFailed"));
      return false;
    } finally {
      setBusyKey("");
    }
  }

  function updateCreditForm(userId: string, patch: Partial<CreditFormState>): void {
    setCreditForms((items) => ({
      ...items,
      [userId]: {
        ...(items[userId] ?? initialCreditForm),
        ...patch
      }
    }));
  }

  function updateSetting<K extends keyof AdminSettings>(key: K, value: AdminSettings[K]): void {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <main className="admin-page app-view" data-testid="admin-page">
      <div className="admin-page__inner">
        <header className="admin-header">
          <div className="admin-header__title">
            <span className="admin-kicker">
              <ShieldCheck className="size-4" aria-hidden="true" />
              {t("adminKicker")}
            </span>
            <h1>{t("adminTitle")}</h1>
            <p>{t("adminSubtitle")}</p>
          </div>
          <button
            className="admin-ghost-button"
            type="button"
            onClick={() => void Promise.all([loadUsers(userSearch), loadSettings(), loadAudits(), loadRedemptionCodes()])}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("adminRefresh")}
          </button>
        </header>

        <div className="admin-tabs" role="tablist" aria-label={t("adminTabsAria")}>
          <TabButton active={activeTab === "users"} label={t("adminUsersTab")} tab="users" onSelect={onSelectTab} />
          <TabButton
            active={activeTab === "redemptionCodes"}
            label={t("adminRedemptionCodesTab")}
            tab="redemptionCodes"
            onSelect={onSelectTab}
          />
          <TabButton active={activeTab === "providers"} label={t("adminProvidersTab")} tab="providers" onSelect={onSelectTab} />
          <TabButton active={activeTab === "audits"} label={t("adminAuditsTab")} tab="audits" onSelect={onSelectTab} />
          <TabButton active={activeTab === "settings"} label={t("adminSettingsTab")} tab="settings" onSelect={onSelectTab} />
        </div>

        {error ? <AdminAlert tone="error" message={error} /> : null}
        {notice ? <AdminAlert tone="success" message={notice} /> : null}

        {activeTab === "users" ? (
          <section className="admin-panel" aria-labelledby="admin-users-title">
            <PanelHeading
              icon={<ShieldCheck className="size-5" aria-hidden="true" />}
              title={t("adminUsersTitle")}
              description={t("adminUsersSubtitle")}
            />
            <form className="admin-search" onSubmit={(event) => void submitUserSearch(event)}>
              <Search className="size-4" aria-hidden="true" />
              <input
                aria-label={t("adminSearchLabel")}
                placeholder={t("adminSearchPlaceholder")}
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
              />
              <button type="submit">{t("adminSearchSubmit")}</button>
            </form>
            {loading.users ? (
              <LoadingState label={t("adminLoading")} />
            ) : users.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t("adminColumnUser")}</th>
                      <th>{t("adminColumnRole")}</th>
                      <th>{t("adminColumnStatus")}</th>
                      <th>{t("adminColumnCredits")}</th>
                      <th>{t("adminColumnCreated")}</th>
                      <th>{t("adminColumnActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const isSelf = currentUser?.id === user.id;
                      const form = creditForms[user.id] ?? initialCreditForm;
                      const isUserBusy = busyKey === `user:${user.id}`;
                      const isCreditBusy = busyKey === `credits:${user.id}`;
                      return (
                        <tr key={user.id}>
                          <td>
                            <div className="admin-user-cell">
                              <strong>{user.name}</strong>
                              <span>{user.email}</span>
                              <code>{user.id}</code>
                            </div>
                          </td>
                          <td>
                            <select
                              disabled={isUserBusy || isSelf}
                              value={user.role}
                              onChange={(event) => void updateUser(user, { role: event.target.value as UserRole })}
                            >
                              {roleOptions.map((role) => (
                                <option key={role} value={role}>
                                  {t("adminRoleLabel", { role })}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              disabled={isUserBusy || isSelf}
                              value={user.status}
                              onChange={(event) => void updateUser(user, { status: event.target.value as UserStatus })}
                            >
                              {statusOptions.map((status) => (
                                <option key={status} value={status}>
                                  {t("adminUserStatusLabel", { status })}
                                </option>
                              ))}
                            </select>
                            {isSelf ? <small>{t("adminSelfGuard")}</small> : null}
                          </td>
                          <td>
                            <span className="admin-credit-pill">
                              <Coins className="size-4" aria-hidden="true" />
                              {t("adminCreditBalance", { credits: user.credits })}
                            </span>
                          </td>
                          <td>{formatDateTime(user.createdAt)}</td>
                          <td>
                            <div className="admin-credit-form">
                              <select
                                aria-label={t("adminCreditModeLabel")}
                                disabled={isCreditBusy}
                                value={form.mode}
                                onChange={(event) =>
                                  updateCreditForm(user.id, {
                                    mode: event.target.value as AdminCreditAdjustmentMode
                                  })
                                }
                              >
                                <option value="delta">{t("adminCreditModeDelta")}</option>
                                <option value="set">{t("adminCreditModeSet")}</option>
                              </select>
                              <input
                                aria-label={t("adminCreditAmount")}
                                disabled={isCreditBusy}
                                inputMode="numeric"
                                value={form.amount}
                                onChange={(event) => updateCreditForm(user.id, { amount: event.target.value })}
                              />
                              <input
                                aria-label={t("adminCreditNote")}
                                disabled={isCreditBusy}
                                placeholder={t("adminCreditNotePlaceholder")}
                                value={form.note}
                                onChange={(event) => updateCreditForm(user.id, { note: event.target.value })}
                              />
                              <button disabled={isCreditBusy} type="button" onClick={() => void adjustCredits(user)}>
                                {isCreditBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Coins className="size-4" aria-hidden="true" />}
                                {t("adminCreditApply")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState label={t("adminEmptyUsers")} />
            )}
          </section>
        ) : null}

        {activeTab === "redemptionCodes" ? (
          <section className="admin-panel" aria-labelledby="admin-redemption-codes-title">
            <PanelHeading
              icon={<Gift className="size-5" aria-hidden="true" />}
              title={t("adminRedemptionCodesTitle")}
              description={t("adminRedemptionCodesSubtitle")}
            />
            <form className="admin-redemption-form" onSubmit={(event) => void createRedemptionCodes(event)}>
              <label>
                <span>{t("adminRedemptionCodeCredits")}</span>
                <input
                  max={10000}
                  min={1}
                  required
                  type="number"
                  value={redemptionCodeForm.credits}
                  onChange={(event) => setRedemptionCodeForm((value) => ({ ...value, credits: event.target.value }))}
                />
              </label>
              <label>
                <span>{t("adminRedemptionCodeCount")}</span>
                <input
                  max={200}
                  min={1}
                  required
                  type="number"
                  value={redemptionCodeForm.count}
                  onChange={(event) => setRedemptionCodeForm((value) => ({ ...value, count: event.target.value }))}
                />
              </label>
              <div className="admin-redemption-expiry-field">
                <label htmlFor="admin-redemption-expires-at">
                  <span>{t("adminRedemptionCodeExpiresAt")}</span>
                  <input
                    id="admin-redemption-expires-at"
                    step={1}
                    type="datetime-local"
                    value={redemptionCodeForm.expiresAt}
                    onChange={(event) =>
                      setRedemptionCodeForm((value) => ({ ...value, expiresAt: event.target.value }))
                    }
                  />
                </label>
                <div className="admin-redemption-expiry-presets" aria-label={t("adminRedemptionCodeExpiryQuickLabel")}>
                  {redemptionCodeExpiryPresetOptions.map((option) => (
                    <button key={option.id} type="button" onClick={() => applyRedemptionCodeExpiryPreset(option)}>
                      {t(option.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <button className="admin-primary-button" disabled={busyKey === "redemption:create"} type="submit">
                {busyKey === "redemption:create" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Gift className="size-4" aria-hidden="true" />
                )}
                {t("adminRedemptionCodeCreate")}
              </button>
            </form>

            {createdRedemptionCodes.length > 0 ? (
              <div className="admin-redemption-created" aria-live="polite">
                <strong>{t("adminRedemptionCodeCreatedTitle")}</strong>
                <div className="admin-redemption-created__list">
                  {createdRedemptionCodes.map((code) => (
                    <button key={code.id} type="button" onClick={() => void copyRedemptionCode(code)}>
                      <code>{code.code}</code>
                      <Copy className="size-4" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {loading.redemptionCodes ? (
              <LoadingState label={t("adminLoading")} />
            ) : sortedRedemptionCodes.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table admin-redemption-table">
                  <thead>
                    <tr>
                      <th>{t("adminRedemptionCodeColumnCode")}</th>
                      <th>{t("adminColumnCredits")}</th>
                      <th>{t("adminColumnStatus")}</th>
                      <th>{t("adminRedemptionCodeColumnRedeemed")}</th>
                      <th>{t("adminRedemptionCodeExpiresAt")}</th>
                      <th>{t("adminColumnCreated")}</th>
                      <th>{t("adminColumnActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRedemptionCodes.map((code) => {
                      const isRedeemed = Boolean(code.redeemedAt || code.redeemedByUserId);
                      const nextStatus: RedemptionCodeStatus = code.status === "active" ? "disabled" : "active";
                      const statusBusy = busyKey === `redemption:status:${code.id}`;
                      const deleteBusy = busyKey === `redemption:delete:${code.id}`;
                      const copyBusy = busyKey === `redemption:copy:${code.id}`;
                      return (
                        <tr key={code.id}>
                          <td>
                            <div className="admin-code-cell">
                              <code>{code.code}</code>
                              {copiedRedemptionCodeId === code.id ? <span>{t("adminRedemptionCodeCopiedShort")}</span> : null}
                            </div>
                          </td>
                          <td>{t("adminCreditBalance", { credits: code.credits })}</td>
                          <td>
                            <span className={`admin-redemption-status admin-redemption-status--${code.status}`}>
                              {redemptionStatusLabel(code.status, t)}
                            </span>
                          </td>
                          <td>
                            {isRedeemed ? (
                              <div className="admin-code-cell">
                                <strong>{code.redeemedByUserName || code.redeemedByUserEmail || code.redeemedByUserId}</strong>
                                <span>{code.redeemedAt ? formatDateTime(code.redeemedAt) : t("commonNotRecorded")}</span>
                              </div>
                            ) : (
                              t("adminRedemptionCodeUnredeemed")
                            )}
                          </td>
                          <td>{code.expiresAt ? formatDateTime(code.expiresAt) : t("adminRedemptionCodeNeverExpires")}</td>
                          <td>{formatDateTime(code.createdAt)}</td>
                          <td>
                            <div className="admin-row-actions">
                              <button disabled={copyBusy} type="button" onClick={() => void copyRedemptionCode(code)}>
                                {copyBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                                {t("commonCopy")}
                              </button>
                              <button
                                disabled={statusBusy}
                                type="button"
                                onClick={() => void updateRedemptionCodeStatus(code, nextStatus)}
                              >
                                {statusBusy ? (
                                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                ) : nextStatus === "active" ? (
                                  <Power className="size-4" aria-hidden="true" />
                                ) : (
                                  <PowerOff className="size-4" aria-hidden="true" />
                                )}
                                {nextStatus === "active" ? t("adminRedemptionCodeEnable") : t("adminRedemptionCodeDisable")}
                              </button>
                              <button disabled={isRedeemed || deleteBusy} type="button" onClick={() => void deleteRedemptionCode(code)}>
                                {deleteBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                                {t("commonRemove")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState label={t("adminRedemptionCodesEmpty")} />
            )}
          </section>
        ) : null}

        {activeTab === "providers" ? (
          <section className="admin-panel" aria-labelledby="admin-providers-title">
            <PanelHeading
              icon={<KeyRound className="size-5" aria-hidden="true" />}
              title={t("adminProvidersTitle")}
              description={t("adminProvidersSubtitle")}
            />
            <ProviderConfigPanel {...providerConfig} variant="page" />
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section className="admin-panel" aria-labelledby="admin-settings-title">
            <PanelHeading
              icon={<Settings className="size-5" aria-hidden="true" />}
              title={t("adminSettingsTitle")}
              description={t("adminSettingsSubtitle")}
            />
            {loading.settings || !settings ? (
              <LoadingState label={t("adminLoading")} />
            ) : (
              <>
                <div className="admin-settings-grid">
                  <label className="admin-switch-row">
                    <span>
                      <strong>{t("adminSettingAllowRegistration")}</strong>
                      <small>{t("adminSettingAllowRegistrationHint")}</small>
                    </span>
                    <input
                      checked={settings.allowRegistration}
                      type="checkbox"
                      onChange={(event) => updateSetting("allowRegistration", event.target.checked)}
                    />
                  </label>
                  <label className="admin-switch-row">
                    <span>
                      <strong>{t("adminSettingRequireApproval")}</strong>
                      <small>{t("adminSettingRequireApprovalHint")}</small>
                    </span>
                    <input
                      checked={settings.requireApproval}
                      type="checkbox"
                      onChange={(event) => updateSetting("requireApproval", event.target.checked)}
                    />
                  </label>
                  <NumberSetting
                    label={t("adminSettingDefaultCredits")}
                    min={0}
                    value={settings.defaultCredits}
                    onChange={(value) => updateSetting("defaultCredits", value)}
                  />
                  <NumberSetting
                    label={t("adminSettingGenerationCreditCost")}
                    min={0}
                    value={settings.generationCreditCost}
                    onChange={(value) => updateSetting("generationCreditCost", value)}
                  />
                  <NumberSetting
                    label={t("adminSettingCheckinCredit")}
                    min={0}
                    value={settings.checkinCredit}
                    onChange={(value) => updateSetting("checkinCredit", value)}
                  />
                  <NumberSetting
                    label={t("adminSettingMaxImages")}
                    min={1}
                    value={settings.maxImagesPerRequest}
                    onChange={(value) => updateSetting("maxImagesPerRequest", value)}
                  />
                </div>
                <div className="admin-panel-actions">
                  <button className="admin-primary-button" disabled={busyKey === "settings"} type="button" onClick={() => void saveSettings()}>
                    {busyKey === "settings" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                    {t("adminSaveSettings")}
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {activeTab === "audits" ? (
          <section className="admin-panel" aria-labelledby="admin-audits-title">
            <PanelHeading
              icon={<Search className="size-5" aria-hidden="true" />}
              title={t("adminAuditsTitle")}
              description={t("adminAuditsSubtitle")}
            />
            {loading.audits ? (
              <LoadingState label={t("adminLoading")} />
            ) : sortedAudits.length > 0 ? (
              <div className="admin-audit-list">
                {sortedAudits.map((audit) => (
                  <article className="admin-audit-row" key={audit.id}>
                    <div className="admin-audit-row__main">
                      <div className="admin-audit-row__meta">
                        <span className={`admin-status admin-status--${audit.status}`}>{t("statusLabel", { status: audit.status })}</span>
                        <span>{t("modeLabel", { mode: audit.mode })}</span>
                        <span>{formatDateTime(audit.createdAt)}</span>
                        {audit.isPublic ? <span>{t("adminAuditPublic")}</span> : <span>{t("adminAuditPrivate")}</span>}
                      </div>
                      <p>{audit.prompt}</p>
                      {audit.errorSummary ? (
                        <p className="admin-audit-row__error">
                          <AlertTriangle className="size-4" aria-hidden="true" />
                          {audit.errorSummary}
                        </p>
                      ) : null}
                    </div>
                    <div className="admin-audit-row__side">
                      <span>{audit.user ? `${audit.user.name} · ${audit.user.email}` : t("adminAuditAnonymousUser")}</span>
                      <span>{t("adminAuditOutputCount", { count: audit.outputs.length })}</span>
                      <span>{t("adminAuditIp", { ip: audit.ipAddress || "-" })}</span>
                      <span title={audit.userAgent}>{t("adminAuditUserAgent", { userAgent: audit.userAgent || "-" })}</span>
                      <div className="admin-audit-outputs">
                        {audit.outputs.length > 0 ? (
                          audit.outputs.map((output) =>
                            output.asset ? (
                              <a
                                className="admin-audit-output"
                                href={output.asset.url}
                                key={output.outputId}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {output.asset.fileName}
                                <span>{t("statusLabel", { status: output.status })}</span>
                              </a>
                            ) : (
                              <span className="admin-audit-output" key={output.outputId}>
                                {output.outputId}
                                <span>{t("statusLabel", { status: output.status })}</span>
                              </span>
                            )
                          )
                        ) : (
                          <span>{t("adminAuditNoOutputs")}</span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState label={t("adminEmptyAudits")} />
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function TabButton({
  active,
  label,
  tab,
  onSelect
}: {
  active: boolean;
  label: string;
  tab: AdminTab;
  onSelect: (tab: AdminTab) => void;
}) {
  return (
    <button aria-selected={active} className={active ? "is-active" : ""} role="tab" type="button" onClick={() => onSelect(tab)}>
      {label}
    </button>
  );
}

function PanelHeading({ description, icon, title }: { description: string; icon: ReactNode; title: string }) {
  return (
    <div className="admin-panel-heading">
      {icon}
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function AdminAlert({ message, tone }: { message: string; tone: "error" | "success" }) {
  return (
    <div className={`admin-alert admin-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "error" ? <AlertTriangle className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
      {message}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="admin-empty-state" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="admin-empty-state">{label}</div>;
}

function NumberSetting({
  label,
  min,
  value,
  onChange
}: {
  label: string;
  min: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="admin-number-row">
      <span>{label}</span>
      <input
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10) || min)}
      />
    </label>
  );
}

function redemptionStatusLabel(status: RedemptionCodeStatus, t: Translate): string {
  return status === "disabled" ? t("adminRedemptionCodeStatusDisabled") : t("adminRedemptionCodeStatusActive");
}

function mergeRedemptionCodes(newItems: RedemptionCodeSummary[], currentItems: RedemptionCodeSummary[]): RedemptionCodeSummary[] {
  const next = new Map<string, RedemptionCodeSummary>();
  for (const item of [...newItems, ...currentItems]) {
    next.set(item.id, item);
  }
  return [...next.values()];
}

function redemptionCodeExpiryPresetValue(option: RedemptionCodeExpiryPresetOption): string {
  const baseDate = new Date();
  const expiresAt = option.unit === "months" ? addCalendarMonths(baseDate, option.amount) : addCalendarDays(baseDate, option.amount);
  expiresAt.setHours(23, 59, 59, 0);
  return formatDateTimeLocalInputValue(expiresAt);
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

function formatDateTimeLocalInputValue(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function prepareSingleCodeClipboardWrite(createPromise: Promise<unknown>): Promise<boolean> | undefined {
  if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") {
    return undefined;
  }

  try {
    const item = new ClipboardItem({
      "text/plain": createPromise.then((body) => {
        if (!isAdminCreateRedemptionCodesResponse(body) || body.items.length !== 1) {
          throw new Error("Created redemption code response is invalid.");
        }
        return new Blob([body.items[0].code], { type: "text/plain" });
      })
    });
    return navigator.clipboard.write([item]).then(
      () => true,
      () => false
    );
  } catch {
    return undefined;
  }
}

async function finishPreparedClipboardWrite(writePromise: Promise<boolean> | undefined): Promise<boolean> {
  if (!writePromise) {
    return false;
  }

  try {
    return await writePromise;
  } catch {
    return false;
  }
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 部分浏览器会在异步创建后拒绝 Clipboard API，继续走 textarea fallback。
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.focus();
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}

async function adminRequest<T>(
  url: string,
  options: RequestInit & {
    locale: Locale;
    t: Translate;
  }
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: options.body
      ? {
          "Content-Type": "application/json"
        }
      : undefined,
    method: options.method,
    body: options.body
  });

  if (!response.ok) {
    throw new Error(await readAdminError(response, options.locale, options.t));
  }

  return (await response.json()) as T;
}

async function readAdminError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("adminRequestFailed"),
      locale,
      status: response.status
    });
  } catch {
    return localizedApiErrorMessage({
      fallbackText: t("adminRequestFailed"),
      locale,
      status: response.status
    });
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
