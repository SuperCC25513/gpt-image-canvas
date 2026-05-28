import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  FilePlus2,
  FileText,
  Loader2,
  Plus,
  Power,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type {
  AgentSkillDetail,
  AgentSkillFile,
  AgentSkillListResponse,
  AgentSkillSummary,
  AgentSkillTriggerMode,
  ImportAgentSkillResponse,
  SaveAgentSkillRequest,
  SaveAgentSkillResponse
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";

interface AgentSkillDialogProps {
  onClose: () => void;
}

interface AgentSkillFormState {
  id?: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  source: string;
  enabled: boolean;
  builtIn: boolean;
  required: boolean;
  triggerMode: AgentSkillTriggerMode;
  triggerKeywordsText: string;
  files: AgentSkillFile[];
  selectedFilePath: string;
  hasLocalChanges: boolean;
}

type DialogMode = "detail" | "create";
type DialogMessageTone = "success" | "error";

interface DialogMessage {
  tone: DialogMessageTone;
  text: string;
}

const SKILL_MARKDOWN_FILE = "SKILL.md";
const MAX_AGENT_SKILL_IMPORT_BYTES = 2 * 1024 * 1024;
const AGENT_SKILL_IMPORT_EXTENSIONS = [".md", ".zip"] as const;
const AGENT_SKILL_IMPORT_MIME_TYPES = new Set(["text/markdown", "text/plain", "application/zip", "application/x-zip-compressed"]);

export function AgentSkillDialog({ onClose }: AgentSkillDialogProps) {
  const { locale, t } = useI18n();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<AgentSkillDetail | null>(null);
  const [form, setForm] = useState<AgentSkillFormState>(() => emptyFormState());
  const [mode, setMode] = useState<DialogMode>("detail");
  const [message, setMessage] = useState<DialogMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const selectedFile = useMemo(
    () => form.files.find((file) => file.path === form.selectedFilePath) ?? form.files[0],
    [form.files, form.selectedFilePath]
  );

  const loadSkill = useCallback(
    async (id: string, signal?: AbortSignal) => {
      setIsDetailLoading(true);
      setMessage(null);
      try {
        const detail = await fetchAgentSkillDetail(id, locale, t, signal);
        if (signal?.aborted) {
          return;
        }
        setSelectedSkillId(detail.id);
        setSelectedSkill(detail);
        setForm(formFromSkill(detail));
        setMode("detail");
      } catch (error) {
        if (!signal?.aborted) {
          setMessage({ tone: "error", text: errorToText(error, t("agentSkillsLoadFailed")) });
        }
      } finally {
        if (!signal?.aborted) {
          setIsDetailLoading(false);
        }
      }
    },
    [locale, t]
  );

  const refreshSkills = useCallback(
    async (preferredSkillId?: string, signal?: AbortSignal) => {
      setIsLoading(true);
      try {
        const nextSkills = await fetchAgentSkillList(locale, t, signal);
        if (signal?.aborted) {
          return;
        }
        setSkills(nextSkills);
        const nextSelectedId = preferredSkillId ?? selectedSkillId ?? nextSkills[0]?.id ?? null;
        if (nextSelectedId) {
          await loadSkill(nextSelectedId, signal);
        } else {
          setSelectedSkillId(null);
          setSelectedSkill(null);
          setForm(emptyFormState());
        }
      } catch (error) {
        if (!signal?.aborted) {
          setMessage({ tone: "error", text: errorToText(error, t("agentSkillsLoadFailed")) });
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [loadSkill, locale, selectedSkillId, t]
  );

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    async function loadInitialSkills(): Promise<void> {
      setIsLoading(true);
      try {
        const nextSkills = await fetchAgentSkillList(locale, t, controller.signal);
        if (!isActive || controller.signal.aborted) {
          return;
        }
        setSkills(nextSkills);
        const firstSkillId = nextSkills[0]?.id;
        if (!firstSkillId) {
          setSelectedSkillId(null);
          setSelectedSkill(null);
          setForm(emptyFormState());
          return;
        }

        const detail = await fetchAgentSkillDetail(firstSkillId, locale, t, controller.signal);
        if (!isActive || controller.signal.aborted) {
          return;
        }
        setSelectedSkillId(detail.id);
        setSelectedSkill(detail);
        setForm(formFromSkill(detail));
      } catch (error) {
        if (isActive && !controller.signal.aborted) {
          setMessage({ tone: "error", text: errorToText(error, t("agentSkillsLoadFailed")) });
        }
      } finally {
        if (isActive && !controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialSkills();
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [locale, t]);

  const startCreate = useCallback(() => {
    setMode("create");
    setSelectedSkillId(null);
    setSelectedSkill(null);
    setMessage(null);
    setForm(createFormState());
  }, []);

  const saveSkill = useCallback(async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const body = skillRequestFromForm(form);
      const response = await fetch(mode === "create" ? "/api/agent-skills" : `/api/agent-skills/${encodeURIComponent(form.id ?? "")}`, {
        method: mode === "create" ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(await readAgentSkillError(response, locale, t));
      }

      const payload = (await response.json()) as unknown;
      if (!isSaveAgentSkillResponse(payload)) {
        throw new Error(t("agentSkillsSaveFailed"));
      }
      setSelectedSkill(payload.skill);
      setSelectedSkillId(payload.skill.id);
      setForm(formFromSkill(payload.skill));
      setMode("detail");
      setMessage({ tone: "success", text: t(mode === "create" ? "agentSkillsCreated" : "agentSkillsSaved") });
      await refreshSkills(payload.skill.id);
    } catch (error) {
      setMessage({ tone: "error", text: errorToText(error, t("agentSkillsSaveFailed")) });
    } finally {
      setIsSaving(false);
    }
  }, [form, locale, mode, refreshSkills, t]);

  const toggleSkill = useCallback(
    async (skill: AgentSkillSummary) => {
      if (skill.required) {
        setMessage({ tone: "error", text: t("agentSkillsCoreLocked") });
        return;
      }

      setMessage(null);
      try {
        const response = await fetch(`/api/agent-skills/${encodeURIComponent(skill.id)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: skill.name,
            enabled: !skill.enabled
          } satisfies SaveAgentSkillRequest)
        });
        if (!response.ok) {
          throw new Error(await readAgentSkillError(response, locale, t));
        }

        const payload = (await response.json()) as unknown;
        if (!isSaveAgentSkillResponse(payload)) {
          throw new Error(t("agentSkillsSaveFailed"));
        }
        setMessage({ tone: "success", text: payload.skill.enabled ? t("agentSkillsEnabledToast") : t("agentSkillsDisabledToast") });
        await refreshSkills(payload.skill.id);
      } catch (error) {
        setMessage({ tone: "error", text: errorToText(error, t("agentSkillsSaveFailed")) });
      }
    },
    [locale, refreshSkills, t]
  );

  const importSkill = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }

      const validationError = validateAgentSkillImportFile(file, locale);
      if (validationError) {
        setMessage({ tone: "error", text: validationError });
        if (uploadInputRef.current) {
          uploadInputRef.current.value = "";
        }
        return;
      }

      setIsImporting(true);
      setMessage(null);
      try {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/agent-skills/import", {
          method: "POST",
          body
        });
        if (!response.ok) {
          throw new Error(await readAgentSkillError(response, locale, t));
        }

        const payload = (await response.json()) as unknown;
        if (!isImportAgentSkillResponse(payload)) {
          throw new Error(t("agentSkillsImportFailed"));
        }
        setMessage({ tone: "success", text: t("agentSkillsImportDone") });
        await refreshSkills(payload.skill.id);
      } catch (error) {
        setMessage({ tone: "error", text: errorToText(error, t("agentSkillsImportFailed")) });
      } finally {
        setIsImporting(false);
        if (uploadInputRef.current) {
          uploadInputRef.current.value = "";
        }
      }
    },
    [locale, refreshSkills, t]
  );

  const resetBuiltInSkill = useCallback(async () => {
    if (!selectedSkill?.builtIn) {
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/agent-skills/${encodeURIComponent(selectedSkill.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: selectedSkill.name,
          resetToFactory: true
        } satisfies SaveAgentSkillRequest)
      });
      if (!response.ok) {
        throw new Error(await readAgentSkillError(response, locale, t));
      }

      const payload = (await response.json()) as unknown;
      if (!isSaveAgentSkillResponse(payload)) {
        throw new Error(t("agentSkillsSaveFailed"));
      }
      setMessage({ tone: "success", text: t("agentSkillsResetDone") });
      await refreshSkills(payload.skill.id);
    } catch (error) {
      setMessage({ tone: "error", text: errorToText(error, t("agentSkillsSaveFailed")) });
    } finally {
      setIsSaving(false);
    }
  }, [locale, refreshSkills, selectedSkill, t]);

  const updateFileContent = useCallback((content: string) => {
    setForm((current) => ({
      ...current,
      files: current.files.map((file) => (file.path === current.selectedFilePath ? { ...file, content } : file))
    }));
  }, []);

  const addReferenceFile = useCallback(() => {
    setForm((current) => {
      const nextPath = nextReferencePath(current.files);
      return {
        ...current,
        selectedFilePath: nextPath,
        files: [
          ...current.files,
          {
            path: nextPath,
            content: "# Notes\n"
          }
        ]
      };
    });
  }, []);

  const removeSelectedFile = useCallback(() => {
    setForm((current) => {
      if (current.selectedFilePath === SKILL_MARKDOWN_FILE) {
        return current;
      }

      const nextFiles = current.files.filter((file) => file.path !== current.selectedFilePath);
      return {
        ...current,
        files: nextFiles,
        selectedFilePath: nextFiles[0]?.path ?? SKILL_MARKDOWN_FILE
      };
    });
  }, []);

  const canSave = !isSaving && !isDetailLoading && Boolean(form.name.trim()) && Boolean(form.files.find((file) => file.path === SKILL_MARKDOWN_FILE)?.content.trim());
  const isEmpty = !isLoading && skills.length === 0 && mode !== "create";

  return createPortal(
    <div className="agent-skill-dialog-backdrop">
      <section className="agent-skill-dialog" aria-labelledby="agent-skill-dialog-title" aria-modal="true" role="dialog">
        <header className="agent-skill-dialog__header">
          <div className="agent-skill-dialog__title-block">
            <span className="agent-skill-dialog__icon" aria-hidden="true">
              <BookOpenCheck className="size-5" />
            </span>
            <div>
              <h2 id="agent-skill-dialog-title">{t("agentSkillsTitle")}</h2>
              <p>{t("agentSkillsSubtitle")}</p>
            </div>
          </div>
          <button aria-label={t("commonClose")} className="agent-skill-dialog__close" type="button" onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        {message ? (
          <div className="agent-skill-message" data-tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
            {message.tone === "error" ? <AlertTriangle className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            <span>{message.text}</span>
          </div>
        ) : null}

        <div className="agent-skill-dialog__body">
          <aside className="agent-skill-sidebar" aria-label={t("agentSkillsListLabel")}>
            <div className="agent-skill-sidebar__actions">
              <button className="agent-skill-action" type="button" onClick={startCreate}>
                <Plus className="size-4" aria-hidden="true" />
                {t("agentSkillsCreate")}
              </button>
              <button className="agent-skill-action" disabled={isImporting} type="button" onClick={() => uploadInputRef.current?.click()}>
                {isImporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
                {t("agentSkillsUpload")}
              </button>
              <input
                ref={uploadInputRef}
                accept=".md,.zip,text/markdown,application/zip"
                className="sr-only"
                type="file"
                onChange={(event) => void importSkill(event.target.files?.[0])}
              />
            </div>

            <div className="agent-skill-list" data-loading={isLoading}>
              {isLoading ? (
                <div className="agent-skill-loading">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("agentSkillsLoading")}
                </div>
              ) : null}
              {skills.map((skill) => (
                <article className="agent-skill-row" data-selected={selectedSkillId === skill.id} key={skill.id}>
                  <button className="agent-skill-row__select" type="button" onClick={() => void loadSkill(skill.id)}>
                    <span className="agent-skill-row__name">{skill.name}</span>
                    <span className="agent-skill-row__meta">
                      {skill.builtIn ? t("agentSkillsBuiltin") : t("agentSkillsUser")} · {triggerStatusLabel(skill, t)}
                    </span>
                    <span className="agent-skill-row__badges">
                      {skill.required ? <span>{t("agentSkillsRequired")}</span> : null}
                      {skill.hasLocalChanges ? <span>{t("agentSkillsLocalOverride")}</span> : null}
                    </span>
                  </button>
                  <button
                    aria-label={skill.enabled ? t("agentSkillsDisableSkill", { name: skill.name }) : t("agentSkillsEnableSkill", { name: skill.name })}
                    aria-pressed={skill.enabled}
                    className="agent-skill-switch"
                    disabled={skill.required}
                    title={skill.required ? t("agentSkillsCoreLocked") : undefined}
                    type="button"
                    onClick={() => void toggleSkill(skill)}
                  >
                    <Power className="size-3.5" aria-hidden="true" />
                  </button>
                </article>
              ))}
              {isEmpty ? <p className="agent-skill-empty">{t("agentSkillsEmpty")}</p> : null}
            </div>
          </aside>

          <main className="agent-skill-detail" aria-label={t("agentSkillsDetailLabel")}>
            {isDetailLoading ? (
              <div className="agent-skill-loading agent-skill-loading--detail">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                {t("agentSkillsDetailLoading")}
              </div>
            ) : (
              <>
                <div className="agent-skill-detail__topline">
                  <div>
                    <p className="agent-skill-detail__eyebrow">{mode === "create" ? t("agentSkillsCreateTitle") : t("agentSkillsEditTitle")}</p>
                    <h3>{form.name || t("agentSkillsUntitled")}</h3>
                  </div>
                  <div className="agent-skill-detail__badges">
                    {form.builtIn ? <span>{t("agentSkillsBuiltin")}</span> : <span>{t("agentSkillsUser")}</span>}
                    {form.required ? <span>{t("agentSkillsRequired")}</span> : null}
                    {form.hasLocalChanges ? <span>{t("agentSkillsLocalOverride")}</span> : null}
                  </div>
                </div>

                <div className="agent-skill-form-grid">
                  <label className="agent-skill-field">
                    <span>{t("agentSkillsFieldName")}</span>
                    <input value={form.name} onChange={(event) => setFormField(setForm, "name", event.target.value)} />
                  </label>
                  <label className="agent-skill-field">
                    <span>{t("agentSkillsFieldSlug")}</span>
                    <input
                      disabled={form.builtIn && mode === "detail"}
                      value={form.slug}
                      onChange={(event) => setFormField(setForm, "slug", event.target.value)}
                    />
                  </label>
                  <label className="agent-skill-field agent-skill-field--wide">
                    <span>{t("agentSkillsFieldDescription")}</span>
                    <textarea rows={2} value={form.description} onChange={(event) => setFormField(setForm, "description", event.target.value)} />
                  </label>
                  <label className="agent-skill-field">
                    <span>{t("agentSkillsFieldVersion")}</span>
                    <input value={form.version} onChange={(event) => setFormField(setForm, "version", event.target.value)} />
                  </label>
                  <label className="agent-skill-field">
                    <span>{t("agentSkillsFieldSource")}</span>
                    <input value={form.source} onChange={(event) => setFormField(setForm, "source", event.target.value)} />
                  </label>
                </div>

                <div className="agent-skill-trigger-panel">
                  <label className="agent-skill-check">
                    <input
                      checked={form.enabled}
                      disabled={form.required}
                      type="checkbox"
                      onChange={(event) => setFormField(setForm, "enabled", event.target.checked)}
                    />
                    <span>{form.required ? t("agentSkillsCoreLocked") : t("agentSkillsEnabled")}</span>
                  </label>
                  <label className="agent-skill-field">
                    <span>{t("agentSkillsTriggerMode")}</span>
                    <select
                      disabled={form.required}
                      value={form.triggerMode}
                      onChange={(event) => setFormField(setForm, "triggerMode", event.target.value as AgentSkillTriggerMode)}
                    >
                      <option value="always">{t("agentSkillsTriggerAlways")}</option>
                      <option value="auto">{t("agentSkillsTriggerAuto")}</option>
                    </select>
                  </label>
                  <label className="agent-skill-field agent-skill-field--keywords">
                    <span>{t("agentSkillsKeywords")}</span>
                    <textarea
                      placeholder={t("agentSkillsKeywordsPlaceholder")}
                      rows={2}
                      value={form.triggerKeywordsText}
                      onChange={(event) => setFormField(setForm, "triggerKeywordsText", event.target.value)}
                    />
                  </label>
                </div>

                <section className="agent-skill-files" aria-label={t("agentSkillsFileList")}>
                  <div className="agent-skill-files__rail">
                    <div className="agent-skill-files__header">
                      <span>{t("agentSkillsFileList")}</span>
                      <button aria-label={t("agentSkillsAddReference")} type="button" onClick={addReferenceFile}>
                        <FilePlus2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="agent-skill-file-list">
                      {form.files.map((file) => (
                        <button
                          className="agent-skill-file-button"
                          data-selected={file.path === selectedFile?.path}
                          key={file.path}
                          type="button"
                          onClick={() => setFormField(setForm, "selectedFilePath", file.path)}
                        >
                          <FileText className="size-4" aria-hidden="true" />
                          <span>{file.path}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="agent-skill-editor">
                    <div className="agent-skill-editor__bar">
                      <span>{selectedFile?.path ?? SKILL_MARKDOWN_FILE}</span>
                      <button disabled={!selectedFile || selectedFile.path === SKILL_MARKDOWN_FILE} type="button" onClick={removeSelectedFile}>
                        <Trash2 className="size-4" aria-hidden="true" />
                        {t("agentSkillsRemoveFile")}
                      </button>
                    </div>
                    <textarea
                      aria-label={t("agentSkillsEditorLabel")}
                      spellCheck={false}
                      value={selectedFile?.content ?? ""}
                      onChange={(event) => updateFileContent(event.target.value)}
                    />
                  </div>
                </section>

                <footer className="agent-skill-detail__footer">
                  {selectedSkill?.builtIn ? (
                    <button className="agent-skill-secondary" disabled={isSaving} type="button" onClick={() => void resetBuiltInSkill()}>
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {t("agentSkillsResetFactory")}
                    </button>
                  ) : (
                    <span />
                  )}
                  <button className="agent-skill-save" disabled={!canSave} type="button" onClick={() => void saveSkill()}>
                    {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                    {t("agentSkillsSave")}
                  </button>
                </footer>
              </>
            )}
          </main>
        </div>
      </section>
    </div>,
    document.body
  );
}

function emptyFormState(): AgentSkillFormState {
  return {
    slug: "",
    name: "",
    description: "",
    version: "",
    source: "",
    enabled: true,
    builtIn: false,
    required: false,
    triggerMode: "auto",
    triggerKeywordsText: "",
    files: [
      {
        path: SKILL_MARKDOWN_FILE,
        content: ""
      }
    ],
    selectedFilePath: SKILL_MARKDOWN_FILE,
    hasLocalChanges: false
  };
}

function createFormState(): AgentSkillFormState {
  return {
    ...emptyFormState(),
    slug: "custom-skill",
    name: "Custom skill",
    description: "Describe when the Agent should use this skill.",
    files: [
      {
        path: SKILL_MARKDOWN_FILE,
        content: "---\nname: custom-skill\ndescription: Describe when the Agent should use this skill.\nmetadata:\n  version: \"1\"\n---\n# Custom Skill\n\nWrite local Agent planning instructions here.\n"
      }
    ]
  };
}

function formFromSkill(skill: AgentSkillDetail): AgentSkillFormState {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    version: skill.version ?? "",
    source: skill.source ?? "",
    enabled: skill.enabled,
    builtIn: skill.builtIn,
    required: skill.required,
    triggerMode: skill.triggerMode,
    triggerKeywordsText: skill.triggerKeywords.join("\n"),
    files: skill.files.length > 0 ? skill.files : [{ path: SKILL_MARKDOWN_FILE, content: "" }],
    selectedFilePath: skill.files.some((file) => file.path === SKILL_MARKDOWN_FILE) ? SKILL_MARKDOWN_FILE : skill.files[0]?.path ?? SKILL_MARKDOWN_FILE,
    hasLocalChanges: skill.hasLocalChanges
  };
}

function skillRequestFromForm(form: AgentSkillFormState): SaveAgentSkillRequest {
  return {
    slug: form.slug,
    name: form.name,
    description: form.description,
    version: form.version || undefined,
    source: form.source || undefined,
    enabled: form.required ? true : form.enabled,
    triggerMode: form.required ? "always" : form.triggerMode,
    triggerKeywords: keywordsFromText(form.triggerKeywordsText),
    files: form.files
  };
}

function setFormField<K extends keyof AgentSkillFormState>(
  setForm: Dispatch<SetStateAction<AgentSkillFormState>>,
  key: K,
  value: AgentSkillFormState[K]
): void {
  setForm((current) => ({
    ...current,
    [key]: value
  }));
}

function keywordsFromText(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/u).map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 32);
}

function nextReferencePath(files: AgentSkillFile[]): string {
  for (let index = 1; index < 100; index += 1) {
    const path = `references/notes-${index}.md`;
    if (!files.some((file) => file.path === path)) {
      return path;
    }
  }

  return `references/notes-${Date.now()}.md`;
}

function triggerStatusLabel(skill: AgentSkillSummary, t: Translate): string {
  if (!skill.enabled) {
    return t("agentSkillsTriggerDisabled");
  }

  if (skill.required || skill.triggerMode === "always") {
    return t("agentSkillsTriggerAlwaysActive");
  }

  return skill.triggerKeywords.length > 0 ? t("agentSkillsTriggerKeywordReady") : t("agentSkillsTriggerAutoReady");
}

async function fetchAgentSkillList(locale: Locale, t: Translate, signal?: AbortSignal): Promise<AgentSkillSummary[]> {
  const response = await fetch("/api/agent-skills", { signal });
  if (!response.ok) {
    throw new Error(await readAgentSkillError(response, locale, t));
  }

  const body = (await response.json()) as unknown;
  if (!isAgentSkillListResponse(body)) {
    throw new Error(t("agentSkillsLoadFailed"));
  }
  return body.skills;
}

async function fetchAgentSkillDetail(id: string, locale: Locale, t: Translate, signal?: AbortSignal): Promise<AgentSkillDetail> {
  const response = await fetch(`/api/agent-skills/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) {
    throw new Error(await readAgentSkillError(response, locale, t));
  }

  const body = (await response.json()) as unknown;
  if (!isAgentSkillDetailResponse(body)) {
    throw new Error(t("agentSkillsLoadFailed"));
  }
  return body.skill;
}

async function readAgentSkillError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("agentSkillsRequestFailed", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("agentSkillsRequestFailed", { status: response.status });
  }
}

function errorToText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function validateAgentSkillImportFile(file: File, locale: Locale): string | null {
  const name = file.name.toLocaleLowerCase();
  const hasAllowedExtension = AGENT_SKILL_IMPORT_EXTENSIONS.some((extension) => name.endsWith(extension));
  const hasAllowedMime = !file.type || AGENT_SKILL_IMPORT_MIME_TYPES.has(file.type.toLocaleLowerCase());
  if (!hasAllowedExtension || !hasAllowedMime) {
    return locale === "zh-CN" ? "只能上传 SKILL.md 或 zip Skill 包。" : "Upload a SKILL.md file or zip skill bundle.";
  }

  if (file.size > MAX_AGENT_SKILL_IMPORT_BYTES) {
    return locale === "zh-CN" ? "Skill 导入文件不能超过 2 MB。" : "Skill import files must be 2 MB or smaller.";
  }

  return null;
}

function isAgentSkillListResponse(value: unknown): value is AgentSkillListResponse {
  return isRecord(value) && Array.isArray(value.skills) && value.skills.every(isAgentSkillSummary);
}

function isSaveAgentSkillResponse(value: unknown): value is SaveAgentSkillResponse {
  return isAgentSkillDetailResponse(value);
}

function isImportAgentSkillResponse(value: unknown): value is ImportAgentSkillResponse {
  return isAgentSkillDetailResponse(value);
}

function isAgentSkillDetailResponse(value: unknown): value is { skill: AgentSkillDetail } {
  return isRecord(value) && isAgentSkillDetail(value.skill);
}

function isAgentSkillDetail(value: unknown): value is AgentSkillDetail {
  const detail = value as Partial<AgentSkillDetail>;
  return isAgentSkillSummary(value) && Array.isArray(detail.files) && detail.files.every(isAgentSkillFile);
}

function isAgentSkillSummary(value: unknown): value is AgentSkillSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    (value.version === undefined || typeof value.version === "string") &&
    (value.source === undefined || typeof value.source === "string") &&
    typeof value.enabled === "boolean" &&
    typeof value.builtIn === "boolean" &&
    typeof value.required === "boolean" &&
    (value.triggerMode === "always" || value.triggerMode === "auto") &&
    Array.isArray(value.triggerKeywords) &&
    value.triggerKeywords.every((keyword) => typeof keyword === "string") &&
    isFiniteNumber(value.fileCount) &&
    typeof value.hasLocalChanges === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isAgentSkillFile(value: unknown): value is AgentSkillFile {
  return isRecord(value) && typeof value.path === "string" && typeof value.content === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
