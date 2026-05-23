import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck
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
  CurrentUser,
  UserRole,
  UserStatus
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { ProviderConfigPanel, type ProviderConfigPanelProps } from "../provider-config/ProviderConfigDialog";

export type AdminTab = "users" | "providers" | "settings" | "audits";

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

const roleOptions: UserRole[] = ["user", "admin"];
const statusOptions: UserStatus[] = ["active", "pending", "disabled"];

const initialCreditForm: CreditFormState = {
  mode: "delta",
  amount: "1",
  note: ""
};

export function AdminPage({ activeTab, currentUser, onSelectTab, providerConfig }: AdminPageProps) {
  const { formatDateTime, locale, t } = useI18n();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [audits, setAudits] = useState<AdminGenerationAuditRecord[]>([]);
  const [creditForms, setCreditForms] = useState<Record<string, CreditFormState>>({});
  const [loading, setLoading] = useState({
    users: true,
    settings: true,
    audits: true
  });
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const sortedAudits = useMemo(
    () => [...audits].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [audits]
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

  useEffect(() => {
    void Promise.all([loadUsers(""), loadSettings(), loadAudits()]);
  }, [loadAudits, loadSettings, loadUsers]);

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
          <button className="admin-ghost-button" type="button" onClick={() => void Promise.all([loadUsers(userSearch), loadSettings(), loadAudits()])}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("adminRefresh")}
          </button>
        </header>

        <div className="admin-tabs" role="tablist" aria-label={t("adminTabsAria")}>
          <TabButton active={activeTab === "users"} label={t("adminUsersTab")} tab="users" onSelect={onSelectTab} />
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
