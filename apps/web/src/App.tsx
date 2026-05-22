import { LogIn, LogOut, Loader2, UserPlus } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AuthMeResponse, AuthRegisterResponse, AuthSessionResponse, CurrentUser } from "@gpt-image-canvas/shared";
import { App as CanvasApp } from "./features/canvas/CanvasApp";
import { localizedApiErrorMessage, useI18n } from "./shared/i18n";

type AuthMode = "login" | "register";

interface AuthFormState {
  name: string;
  email: string;
  password: string;
}

interface LoadMeOptions {
  preserveCurrentUserOnError?: boolean;
}

const initialFormState: AuthFormState = {
  name: "",
  email: "",
  password: ""
};

const PublicGalleryPage = lazy(() =>
  import("./features/gallery/GalleryPage").then((module) => ({
    default: module.GalleryPage
  }))
);

export function App() {
  const { locale, t } = useI18n();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthMeResponse | null>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [form, setForm] = useState<AuthFormState>(initialFormState);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadMe = useCallback(async (signal?: AbortSignal, options: LoadMeOptions = {}) => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "same-origin",
        signal
      });
      if (!response.ok) {
        throw new Error(await readAuthError(response, locale, t("authLoadFailed")));
      }

      const body = (await response.json()) as AuthMeResponse;
      setAuthStatus(body);
      setCurrentUser(body.authenticated && body.user ? body.user : null);
    } catch (requestError) {
      if (signal?.aborted) {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : t("authLoadFailed"));
      setAuthStatus((current) => (options.preserveCurrentUserOnError ? current : null));
      if (!options.preserveCurrentUserOnError) {
        setCurrentUser(null);
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [locale, t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMe(controller.signal);
    return () => controller.abort();
  }, [loadMe]);

  const canRegister = authStatus?.settings.allowRegistration ?? true;
  const adminConfigured = authStatus?.settings.adminConfigured ?? false;
  const authCopy = useMemo(() => {
    if (!adminConfigured) {
      return t("authAdminUnavailable");
    }
    if (!canRegister && mode === "register") {
      return t("authRegistrationClosed");
    }
    return mode === "login" ? t("authLoginCopy") : t("authRegisterCopy");
  }, [adminConfigured, canRegister, mode, t]);

  async function submitAuth(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        body: JSON.stringify(mode === "login" ? { email: form.email, password: form.password } : form),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await readAuthError(response, locale, mode === "login" ? t("authLoginFailed") : t("authRegisterFailed")));
      }

      const body = (await response.json()) as AuthSessionResponse | AuthRegisterResponse;
      if (mode === "register" && "status" in body && body.status === "pending") {
        setNotice(t("authRegistrationPending"));
        setMode("login");
        setForm(initialFormState);
        await loadMe();
        return;
      }

      if (!("user" in body)) {
        throw new Error(mode === "login" ? t("authLoginFailed") : t("authRegisterFailed"));
      }

      setCurrentUser(body.user);
      await loadMe(undefined, { preserveCurrentUserOnError: true });
      setForm(initialFormState);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : mode === "login" ? t("authLoginFailed") : t("authRegisterFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function logout(): Promise<void> {
    setError("");
    await fetch("/api/auth/logout", {
      credentials: "same-origin",
      method: "POST"
    });
    setCurrentUser(null);
    await loadMe();
  }

  if (isLoading) {
    return (
      <main className="auth-page" data-testid="auth-loading">
        <div className="auth-shell auth-shell--status" role="status">
          <Loader2 className="auth-spinner" aria-hidden="true" />
          <p>{t("authChecking")}</p>
        </div>
      </main>
    );
  }

  if (currentUser) {
    return (
      <>
        <CanvasApp />
        <div className="auth-user-bar" data-testid="auth-user-bar">
          <span className="auth-user-bar__message" data-tone={error ? "warning" : "neutral"} role={error ? "status" : undefined}>
            {error || t("authSignedInAs", { name: currentUser.name })}
          </span>
          <button type="button" onClick={() => void logout()}>
            <LogOut className="size-4" aria-hidden="true" />
            {t("authLogout")}
          </button>
        </div>
      </>
    );
  }

  if (window.location.pathname === "/public-gallery") {
    return (
      <Suspense
        fallback={
          <main className="gallery-page app-view" data-testid="public-gallery-loading-page">
            <div className="gallery-empty-state gallery-empty-state--boot" role="status">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              <p>{t("galleryLoading")}</p>
            </div>
          </main>
        }
      >
        <PublicGalleryPage variant="public" />
      </Suspense>
    );
  }

  return (
    <main className="auth-page" data-testid="auth-page">
      <section className="auth-shell" aria-labelledby="auth-title">
        <div className="auth-heading">
          <span>{t("appTagline")}</span>
          <h1 id="auth-title">{mode === "login" ? t("authLoginTitle") : t("authRegisterTitle")}</h1>
          <p>{authCopy}</p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label={t("authModeLabel")}>
          <button className={mode === "login" ? "is-active" : ""} type="button" aria-selected={mode === "login"} onClick={() => setMode("login")}>
            <LogIn className="size-4" aria-hidden="true" />
            {t("authLoginTab")}
          </button>
          <button
            className={mode === "register" ? "is-active" : ""}
            disabled={!canRegister}
            type="button"
            aria-selected={mode === "register"}
            onClick={() => setMode("register")}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            {t("authRegisterTab")}
          </button>
        </div>

        <form className="auth-form" onSubmit={(event) => void submitAuth(event)}>
          {mode === "register" ? (
            <label>
              <span>{t("authNameLabel")}</span>
              <input
                autoComplete="name"
                disabled={isSubmitting}
                onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                placeholder={t("authNamePlaceholder")}
                required
                value={form.name}
              />
            </label>
          ) : null}

          <label>
            <span>{t("authEmailLabel")}</span>
            <input
              autoComplete="email"
              disabled={isSubmitting}
              onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))}
              placeholder={t("authEmailPlaceholder")}
              required
              type="email"
              value={form.email}
            />
          </label>

          <label>
            <span>{t("authPasswordLabel")}</span>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={isSubmitting}
              minLength={8}
              onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))}
              placeholder={t("authPasswordPlaceholder")}
              required
              type="password"
              value={form.password}
            />
          </label>

          {error ? <p className="auth-message" role="alert">{error}</p> : null}
          {notice ? <p className="auth-message" data-tone="success" role="status">{notice}</p> : null}

          <button className="primary-action auth-submit" disabled={isSubmitting || (mode === "register" && !canRegister)} type="submit">
            {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : mode === "login" ? <LogIn className="size-4" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}
            {mode === "login" ? t("authSubmitLogin") : t("authSubmitRegister")}
          </button>
        </form>
      </section>
    </main>
  );
}

async function readAuthError(response: Response, locale: "zh-CN" | "en", fallbackText: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText,
      locale,
      status: response.status
    });
  } catch {
    return fallbackText;
  }
}
