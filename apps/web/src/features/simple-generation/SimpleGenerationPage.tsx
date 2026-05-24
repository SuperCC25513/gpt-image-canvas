import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Globe2,
  ImageIcon,
  Loader2,
  LockKeyhole,
  Palette,
  Sparkles,
  Square
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOM_SIZE_PRESET_ID,
  DEFAULT_GENERATION_CREDIT_COST,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  IMAGE_QUALITIES,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  OUTPUT_FORMATS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  type AuthMeResponse,
  type AuthStatusResponse,
  type GalleryImageItem,
  type GenerationCount,
  type GenerationRecord,
  type GeneratedAsset,
  type ImageQuality,
  type OutputFormat,
  type SizePreset,
  type StylePresetId
} from "@gpt-image-canvas/shared";
import { assetDownloadUrl, assetPreviewUrl } from "../../shared/api/assets";
import {
  generatedAssetsForRecord,
  isActiveGenerationRecord,
  isGalleryResponse,
  isGenerationResponse,
  isTerminalGenerationRecord,
  readApiErrorMessage
} from "../../shared/api/generation";
import { useI18n } from "../../shared/i18n";
import { generationCountsWithinLimit } from "../../shared/generationCounts";
import { sizeValidationMessage } from "../../shared/imageValidation";

const SIMPLE_DEFAULT_SIZE_PRESET_ID = "square-1k";
const SIMPLE_DEFAULT_SIZE_PRESET = SIZE_PRESETS.find((preset) => preset.id === SIMPLE_DEFAULT_SIZE_PRESET_ID) ?? SIZE_PRESETS[0];
const SIMPLE_RESULT_LIMIT = 8;
const SIMPLE_RESULT_PREVIEW_WIDTH = 512;
const GENERATION_POLL_INTERVAL_MS = 1500;
const SIMPLE_QUICK_SIZE_IDS = ["square-1k", "poster-portrait", "poster-landscape", "story-9-16", "video-16-9"] as const;
const simpleQuickSizePresets = SIZE_PRESETS.filter((preset) => SIMPLE_QUICK_SIZE_IDS.includes(preset.id as (typeof SIMPLE_QUICK_SIZE_IDS)[number]));

interface SimpleGenerationPageProps {
  accountError: string;
  accountStatus: AuthMeResponse | null;
  authError: string;
  authStatus: AuthStatusResponse | null;
  isAccountLoading: boolean;
  isAuthLoading: boolean;
  onContinueOnCanvas: (input: { assets: GeneratedAsset[]; prompt: string }) => void;
  onOpenCanvas: () => void;
  onOpenGallery: () => void;
  onRefreshAccountStatus: () => void;
}

export function SimpleGenerationPage({
  accountError,
  accountStatus,
  authError,
  authStatus,
  isAccountLoading,
  isAuthLoading,
  onContinueOnCanvas,
  onOpenCanvas,
  onOpenGallery,
  onRefreshAccountStatus
}: SimpleGenerationPageProps) {
  const { locale, t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<StylePresetId>("none");
  const [sizePresetId, setSizePresetId] = useState<string>(SIMPLE_DEFAULT_SIZE_PRESET.id);
  const [width, setWidth] = useState(SIMPLE_DEFAULT_SIZE_PRESET.width);
  const [height, setHeight] = useState(SIMPLE_DEFAULT_SIZE_PRESET.height);
  const [count, setCount] = useState<GenerationCount>(1);
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [publishGeneration, setPublishGeneration] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GalleryImageItem[]>([]);
  const [sessionItems, setSessionItems] = useState<GalleryImageItem[]>([]);
  const [latestRecord, setLatestRecord] = useState<GenerationRecord | null>(null);
  const [isGalleryLoading, setIsGalleryLoading] = useState(true);
  const [galleryError, setGalleryError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationWarning, setGenerationWarning] = useState("");
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | undefined>();
  const generationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadGalleryItems(controller.signal);

    return () => {
      controller.abort();
    };
  }, [locale, t]);

  useEffect(() => {
    return () => {
      window.clearTimeout(copiedTimerRef.current);
      generationControllerRef.current?.abort();
    };
  }, []);

  const accountUser = accountStatus?.authenticated ? accountStatus.user : undefined;
  const creditSettings = accountStatus?.settings;
  const generationCreditCost = creditSettings?.generationCreditCost ?? DEFAULT_GENERATION_CREDIT_COST;
  const maxImagesPerRequest = creditSettings?.maxImagesPerRequest ?? DEFAULT_MAX_IMAGES_PER_REQUEST;
  const generationCountOptions = useMemo(() => generationCountsWithinLimit(maxImagesPerRequest), [maxImagesPerRequest]);
  const fallbackGenerationCount = generationCountOptions[generationCountOptions.length - 1] ?? 1;
  const estimatedCreditCost = Math.max(0, count * generationCreditCost);
  const trimmedPrompt = prompt.trim();
  const dimensionValidationMessage = sizeValidationMessage(width, height, t, locale);
  const providerDetails = simpleProviderDetails(authStatus, isAuthLoading, t);
  const providerValidationMessage =
    isAuthLoading || providerDetails.provider === "openai" || providerDetails.provider === "codex" ? "" : providerDetails.copy;
  const accountValidationMessage = isAccountLoading ? t("authChecking") : accountError || (!accountUser ? t("creditsAccountUnavailable") : "");
  const creditValidationMessage = creditValidationMessageForCount({
    accountCredits: accountUser?.credits,
    count,
    generationCreditCost,
    maxImagesPerRequest,
    t
  });
  const validationMessage =
    (trimmedPrompt ? "" : t("promptRequired")) ||
    dimensionValidationMessage ||
    authError ||
    providerValidationMessage ||
    accountValidationMessage ||
    creditValidationMessage;
  const canGenerate = !validationMessage && !isGenerating;
  const visibleResults = useMemo(() => combineRecentResults(sessionItems, galleryItems), [galleryItems, sessionItems]);
  const latestAssets = latestRecord ? generatedAssetsForRecord(latestRecord) : [];

  useEffect(() => {
    if (!generationCountOptions.includes(count)) {
      setCount(fallbackGenerationCount);
    }
  }, [count, fallbackGenerationCount, generationCountOptions]);

  async function loadGalleryItems(signal?: AbortSignal): Promise<void> {
    setIsGalleryLoading(true);
    setGalleryError("");

    try {
      const response = await fetch("/api/gallery", { signal });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, locale, t("galleryRequestFailed", { status: response.status })));
      }

      const body = (await response.json()) as unknown;
      if (!isGalleryResponse(body)) {
        throw new Error(t("galleryServiceInvalidData"));
      }

      if (!signal?.aborted) {
        setGalleryItems(body.items);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setGalleryError(error instanceof Error ? error.message : t("galleryLoadFailed"));
      }
    } finally {
      if (!signal?.aborted) {
        setIsGalleryLoading(false);
      }
    }
  }

  function selectSizePreset(nextPresetId: string): void {
    if (nextPresetId === CUSTOM_SIZE_PRESET_ID) {
      setSizePresetId(CUSTOM_SIZE_PRESET_ID);
      return;
    }

    const preset = SIZE_PRESETS.find((item) => item.id === nextPresetId);
    if (!preset) {
      return;
    }

    setSizePresetId(preset.id);
    setWidth(preset.width);
    setHeight(preset.height);
  }

  function applyPromptStarter(starter: string): void {
    setPrompt(starter);
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage("");
  }

  async function submitGeneration(): Promise<void> {
    if (!canGenerate) {
      setGenerationWarning(validationMessage);
      return;
    }

    generationControllerRef.current?.abort();
    const controller = new AbortController();
    generationControllerRef.current = controller;
    setIsGenerating(true);
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage(t("simpleGenerationRunning"));

    try {
      const clientRequestId = crypto.randomUUID();
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clientRequestId,
          prompt: trimmedPrompt,
          presetId: stylePreset,
          sizePresetId,
          size: {
            width,
            height
          },
          quality,
          outputFormat,
          count,
          isPublic: publishGeneration
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, locale, t("errorFallback", { status: response.status })));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      const record = isTerminalGenerationRecord(body.record) ? body.record : await pollGenerationUntilComplete(body.record.id, controller.signal);
      if (controller.signal.aborted) {
        return;
      }

      finishGeneration(record);
      onRefreshAccountStatus();
      await loadGalleryItems(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        setGenerationError(error instanceof Error ? error.message : t("generationErrorDefault"));
        setGenerationMessage("");
      }
    } finally {
      if (generationControllerRef.current === controller) {
        generationControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setIsGenerating(false);
      }
    }
  }

  async function pollGenerationUntilComplete(recordId: string, signal: AbortSignal): Promise<GenerationRecord> {
    while (true) {
      await waitForGenerationPollInterval(signal);
      const response = await fetch(`/api/generations/${encodeURIComponent(recordId)}`, { signal });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, locale, t("errorFallback", { status: response.status })));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      if (!isActiveGenerationRecord(body.record)) {
        return body.record;
      }
    }
  }

  function finishGeneration(record: GenerationRecord): void {
    setLatestRecord(record);
    const successfulItems = generationRecordToGalleryItems(record, publishGeneration);
    if (successfulItems.length > 0) {
      setSessionItems((current) => combineRecentResults(successfulItems, current));
    }

    const failedCount = record.outputs.filter((output) => output.status === "failed").length;
    if (successfulItems.length > 0 && failedCount > 0) {
      setGenerationWarning(t("simpleGenerationPartial", { succeeded: successfulItems.length, failed: failedCount }));
      setGenerationMessage("");
      return;
    }

    if (successfulItems.length > 0) {
      setGenerationMessage(t("simpleGenerationSucceeded", { count: successfulItems.length }));
      return;
    }

    setGenerationError(record.error || t("generationErrorDefault"));
    setGenerationMessage("");
  }

  async function copyPrompt(item: GalleryImageItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.prompt);
      setCopiedOutputId(item.outputId);
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopiedOutputId(null), 1600);
    } catch {
      setGenerationWarning(t("generationCopyFailed"));
    }
  }

  function downloadItem(item: GalleryImageItem): void {
    window.open(assetDownloadUrl(item.asset.id), "_blank", "noopener,noreferrer");
  }

  function continueLatestOnCanvas(): void {
    if (latestAssets.length === 0) {
      setGenerationWarning(t("simpleGenerationNoCanvasAssets"));
      return;
    }

    onContinueOnCanvas({
      assets: latestAssets,
      prompt: latestRecord?.prompt ?? prompt
    });
  }

  return (
    <main className="simple-generation-page app-view" data-testid="simple-generation-page">
      <section className="simple-generation-shell" aria-labelledby="simple-generation-title">
        <header className="simple-generation-header">
          <div className="simple-generation-header__copy">
            <p className="simple-generation-kicker">
              <Sparkles className="size-4" aria-hidden="true" />
              {t("simpleGenerationKicker")}
            </p>
            <h1 id="simple-generation-title">{t("simpleGenerationTitle")}</h1>
            <p>{t("simpleGenerationDeck")}</p>
          </div>
          <div className="simple-generation-header__side">
            <div className="simple-mode-switch" role="group" aria-label={t("simpleGenerationModeSwitchAria")}>
              <button className="simple-mode-switch__button is-active" type="button" aria-pressed="true">
                <Sparkles className="size-4" aria-hidden="true" />
                {t("simpleGenerationModeSimple")}
              </button>
              <button className="simple-mode-switch__button" type="button" aria-pressed="false" onClick={onOpenCanvas}>
                <Square className="size-4" aria-hidden="true" />
                {t("simpleGenerationModeCanvas")}
              </button>
            </div>
          </div>
        </header>

        <div className="simple-generation-grid">
          <form
            className="simple-generation-form"
            data-testid="simple-generation-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitGeneration();
            }}
          >
            <section className="simple-prompt-panel" aria-labelledby="simple-prompt-title">
              <div className="simple-prompt-panel__header">
                <div>
                  <label className="control-label" id="simple-prompt-title" htmlFor="simple-generation-prompt-input">
                    {t("generationPromptLabel")}
                  </label>
                  <p id="simple-prompt-hint">{t("simpleGenerationPromptHint")}</p>
                </div>
                <span className="simple-prompt-panel__count">{t("simpleGenerationPromptCount", { count: prompt.length })}</span>
              </div>
              <textarea
                id="simple-generation-prompt-input"
                aria-invalid={Boolean(!trimmedPrompt && generationWarning)}
                aria-describedby="simple-prompt-hint"
                className="prompt-textarea simple-generation-prompt"
                placeholder={t("simpleGenerationPromptPlaceholder")}
                value={prompt}
                data-testid="simple-generation-prompt"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </section>

            {!trimmedPrompt ? (
              <div className="simple-prompt-starters" data-testid="simple-prompt-starters">
                <span>{t("simpleGenerationPromptExamples")}</span>
                {promptStarters.map((starter) => (
                  <button
                    className="prompt-chip"
                    key={starter.labelKey}
                    type="button"
                    title={t(starter.promptKey)}
                    onClick={() => applyPromptStarter(t(starter.promptKey))}
                  >
                    {t(starter.labelKey)}
                  </button>
                ))}
              </div>
            ) : null}

            <section className="simple-generation-section" aria-labelledby="simple-size-title">
              <div className="simple-section-heading">
                <span className="control-label" id="simple-size-title">
                  {t("generationSizeLabel")}
                </span>
                <span>{width} x {height}</span>
              </div>
              <div className="simple-size-grid" data-testid="simple-size-presets">
                {simpleQuickSizePresets.map((preset) => (
                  <button
                    aria-pressed={sizePresetId === preset.id}
                    className={sizePresetId === preset.id ? "simple-size-button is-active" : "simple-size-button"}
                    key={preset.id}
                    type="button"
                    onClick={() => selectSizePreset(preset.id)}
                  >
                    <span>{sizePresetLabel(preset, t)}</span>
                    <small>{preset.width} x {preset.height}</small>
                  </button>
                ))}
              </div>
              <label className="simple-generation-field">
                <span className="sr-only">{t("generationAllSizes")}</span>
                <select
                  className="field-control"
                  value={sizePresetId}
                  data-testid="simple-size-preset-select"
                  onChange={(event) => selectSizePreset(event.target.value)}
                >
                  {SIZE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {sizePresetOptionLabel(preset, t)}
                    </option>
                  ))}
                  <option value={CUSTOM_SIZE_PRESET_ID}>{t("customSizeOption")}</option>
                </select>
              </label>
            </section>

            <div className="simple-generation-two-col">
              <label className="simple-generation-field">
                <span className="control-label">{t("generationStyleLabel")}</span>
                <select
                  className="field-control"
                  value={stylePreset}
                  data-testid="simple-style-preset"
                  onChange={(event) => setStylePreset(event.target.value as StylePresetId)}
                >
                  {STYLE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {t("stylePresetLabel", { presetId: preset.id, fallback: preset.label })}
                    </option>
                  ))}
                </select>
              </label>

              <div className="simple-generation-field">
                <span className="control-label">{t("generationCountLabel")}</span>
                <div className="simple-count-grid" data-testid="simple-count-grid">
                  {generationCountOptions.map((item) => (
                    <button
                      className={item === count ? "segmented-control is-active" : "segmented-control"}
                      key={item}
                      type="button"
                      onClick={() => setCount(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="publish-toggle" data-enabled={publishGeneration}>
              <input
                checked={publishGeneration}
                className="publish-toggle__input"
                data-testid="simple-generation-public-toggle"
                type="checkbox"
                onChange={(event) => setPublishGeneration(event.target.checked)}
              />
              <span className="publish-toggle__icon" aria-hidden="true">
                {publishGeneration ? <Globe2 className="size-4" /> : <LockKeyhole className="size-4" />}
              </span>
              <span className="publish-toggle__copy">
                <span>{t("generationPublishLabel")}</span>
                <small>{t("generationPublishHint")}</small>
              </span>
            </label>

            <details className="simple-advanced">
              <summary>
                <span>
                  <Palette className="size-4" aria-hidden="true" />
                  {t("generationAdvanced")}
                </span>
                <ChevronDown className="simple-advanced__icon size-4" aria-hidden="true" />
              </summary>
              <div className="simple-advanced__body">
                <div className="simple-generation-two-col">
                  <label className="simple-generation-field">
                    <span className="control-label">{t("generationWidthLabel")}</span>
                    <input
                      className="field-control"
                      max={MAX_IMAGE_DIMENSION}
                      min={MIN_IMAGE_DIMENSION}
                      type="number"
                      value={Number.isNaN(width) ? "" : width}
                      data-testid="simple-custom-width"
                      onChange={(event) => {
                        setWidth(normalizeDimension(event.target.value));
                        setSizePresetId(CUSTOM_SIZE_PRESET_ID);
                      }}
                    />
                  </label>
                  <label className="simple-generation-field">
                    <span className="control-label">{t("generationHeightLabel")}</span>
                    <input
                      className="field-control"
                      max={MAX_IMAGE_DIMENSION}
                      min={MIN_IMAGE_DIMENSION}
                      type="number"
                      value={Number.isNaN(height) ? "" : height}
                      data-testid="simple-custom-height"
                      onChange={(event) => {
                        setHeight(normalizeDimension(event.target.value));
                        setSizePresetId(CUSTOM_SIZE_PRESET_ID);
                      }}
                    />
                  </label>
                </div>
                <div className="simple-generation-two-col">
                  <label className="simple-generation-field">
                    <span className="control-label">{t("generationQualityLabel")}</span>
                    <select
                      className="field-control"
                      value={quality}
                      data-testid="simple-quality"
                      onChange={(event) => setQuality(event.target.value as ImageQuality)}
                    >
                      {IMAGE_QUALITIES.map((item) => (
                        <option key={item} value={item}>
                          {t("qualityLabel", { quality: item })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="simple-generation-field">
                    <span className="control-label">{t("generationOutputFormatLabel")}</span>
                    <select
                      className="field-control"
                      value={outputFormat}
                      data-testid="simple-output-format"
                      onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
                    >
                      {OUTPUT_FORMATS.map((item) => (
                        <option key={item} value={item}>
                          {t("outputFormatLabel", { format: item })}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </details>

            <CreditSummary
              accountCredits={accountUser?.credits}
              cost={estimatedCreditCost}
              error={accountError || accountValidationMessage || creditValidationMessage}
              isLoading={isAccountLoading}
              maxImages={maxImagesPerRequest}
              perImageCost={generationCreditCost}
            />

            <StatusMessage
              error={generationError}
              isGenerating={isGenerating}
              message={generationMessage}
              warning={generationWarning || validationMessage}
            />

            <button className="primary-action simple-generate-button" disabled={!canGenerate} type="submit" data-testid="simple-generate-button">
              {isGenerating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
              {isGenerating ? t("simpleGenerationRunningButton") : t("simpleGenerationSubmit")}
            </button>
          </form>

          <section className="simple-results-panel" aria-labelledby="simple-results-title" data-testid="simple-results-panel">
            <div className="simple-results-panel__header">
              <div>
                <p className="control-label">{t("simpleGenerationResultsKicker")}</p>
                <h2 id="simple-results-title">{t("simpleGenerationResultsTitle")}</h2>
              </div>
              <button className="secondary-action simple-results-panel__more" type="button" onClick={onOpenGallery}>
                {t("simpleGenerationViewMore")}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>

            {latestAssets.length > 0 ? (
              <div className="simple-canvas-prompt" role="status">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <span>{t("simpleGenerationCanvasHint", { count: latestAssets.length })}</span>
                <button className="secondary-action" type="button" onClick={continueLatestOnCanvas}>
                  <Square className="size-4" aria-hidden="true" />
                  {t("simpleGenerationContinueCanvas")}
                </button>
              </div>
            ) : null}

            {isGalleryLoading && visibleResults.length === 0 ? (
              <div className="simple-results-empty" role="status">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                <p>{t("simpleGenerationResultsLoading")}</p>
              </div>
            ) : visibleResults.length > 0 ? (
              <div className="simple-results-grid" data-testid="simple-results-grid">
                {visibleResults.map((item) => (
                  <article className="simple-result-card" key={item.outputId}>
                    <button className="simple-result-card__image-button" type="button" onClick={() => onContinueOnCanvas({ assets: [item.asset], prompt: item.prompt })}>
                      <img alt={item.prompt} src={assetPreviewUrl(item.asset.id, SIMPLE_RESULT_PREVIEW_WIDTH)} />
                    </button>
                    <div className="simple-result-card__body">
                      <p title={item.prompt}>{item.prompt}</p>
                      <span>{item.size.width} x {item.size.height}</span>
                    </div>
                    <div className="simple-result-card__actions">
                      <button className="history-icon-action" type="button" title={t("simpleGenerationCopyPrompt")} onClick={() => void copyPrompt(item)}>
                        {copiedOutputId === item.outputId ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                      </button>
                      <button className="history-icon-action" type="button" title={t("simpleGenerationDownload")} onClick={() => downloadItem(item)}>
                        <Download className="size-4" aria-hidden="true" />
                      </button>
                      <button className="history-icon-action" type="button" title={t("simpleGenerationSendToCanvas")} onClick={() => onContinueOnCanvas({ assets: [item.asset], prompt: item.prompt })}>
                        <Square className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="simple-results-empty">
                <ImageIcon className="size-5" aria-hidden="true" />
                <p>{galleryError || t("simpleGenerationResultsEmpty")}</p>
              </div>
            )}

            {galleryError && visibleResults.length > 0 ? (
              <p className="simple-results-warning" role="alert">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {galleryError}
              </p>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}

const promptStarters = [
  {
    labelKey: "promptStarterProductLabel",
    promptKey: "promptStarterProductPrompt"
  },
  {
    labelKey: "promptStarterInteriorLabel",
    promptKey: "promptStarterInteriorPrompt"
  },
  {
    labelKey: "promptStarterAvatarLabel",
    promptKey: "promptStarterAvatarPrompt"
  },
  {
    labelKey: "promptStarterCityLabel",
    promptKey: "promptStarterCityPrompt"
  }
] as const;

function CreditSummary({
  accountCredits,
  cost,
  error,
  isLoading,
  maxImages,
  perImageCost
}: {
  accountCredits?: number;
  cost: number;
  error: string;
  isLoading: boolean;
  maxImages: number;
  perImageCost: number;
}) {
  const { t } = useI18n();

  return (
    <section className="simple-credit-summary" data-warning={Boolean(error)}>
      <div>
        <span className="control-label">{t("creditsTitle")}</span>
        <strong>{isLoading ? t("commonNotSet") : t("creditsBalance", { credits: accountCredits ?? 0 })}</strong>
      </div>
      <div>
        <span>{cost > 0 ? t("creditsEstimatedCost", { cost }) : t("creditsEstimatedFree")}</span>
        <span>{t("creditsPerImage", { cost: perImageCost })}</span>
        <span>{t("creditsMaxImages", { max: maxImages })}</span>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function StatusMessage({
  error,
  isGenerating,
  message,
  warning
}: {
  error: string;
  isGenerating: boolean;
  message: string;
  warning: string;
}) {
  if (error) {
    return (
      <p className="simple-status simple-status--error" role="alert">
        <AlertTriangle className="size-4" aria-hidden="true" />
        {error}
      </p>
    );
  }

  if (warning) {
    return (
      <p className="simple-status simple-status--warning" role="alert">
        <AlertTriangle className="size-4" aria-hidden="true" />
        {warning}
      </p>
    );
  }

  if (message || isGenerating) {
    return (
      <p className="simple-status simple-status--success" role="status">
        {isGenerating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
        {message}
      </p>
    );
  }

  return null;
}

function simpleProviderDetails(authStatus: AuthStatusResponse | null, isAuthLoading: boolean, t: ReturnType<typeof useI18n>["t"]): {
  copy: string;
  provider: "openai" | "codex" | "loading" | "none";
  title: string;
} {
  if (isAuthLoading) {
    return {
      copy: t("providerStatusLoadingCopy"),
      provider: "loading",
      title: t("providerStatusLoadingTitle")
    };
  }

  if (authStatus?.provider === "openai") {
    return {
      copy: t("providerStatusGenericOpenAICopy"),
      provider: "openai",
      title: t("providerStatusImageService")
    };
  }

  if (authStatus?.provider === "codex") {
    return {
      copy: authStatus.codex.email ?? authStatus.codex.accountId ?? t("providerStatusCodexCopy"),
      provider: "codex",
      title: t("providerStatusCodexTitle")
    };
  }

  return {
    copy: t("providerStatusNoneCopy"),
    provider: "none",
    title: t("providerStatusNoneTitle")
  };
}

function creditValidationMessageForCount({
  accountCredits,
  count,
  generationCreditCost,
  maxImagesPerRequest,
  t
}: {
  accountCredits?: number;
  count: number;
  generationCreditCost: number;
  maxImagesPerRequest: number;
  t: ReturnType<typeof useI18n>["t"];
}): string {
  const requestedCreditCost = Math.max(0, count * generationCreditCost);
  if (count > maxImagesPerRequest) {
    return t("creditsMaxImages", { max: maxImagesPerRequest });
  }

  if (accountCredits !== undefined && requestedCreditCost > accountCredits) {
    return t("creditsInsufficient", { balance: accountCredits, cost: requestedCreditCost });
  }

  return "";
}

function generationRecordToGalleryItems(record: GenerationRecord, isPublic: boolean): GalleryImageItem[] {
  return record.outputs.flatMap((output) =>
    output.status === "succeeded" && output.asset
      ? [
          {
            outputId: output.id,
            generationId: record.id,
            mode: record.mode,
            prompt: record.prompt,
            effectivePrompt: record.effectivePrompt,
            presetId: record.presetId,
            size: record.size,
            quality: record.quality,
            outputFormat: record.outputFormat,
            createdAt: record.createdAt,
            asset: output.asset,
            isPublic: output.isPublic ?? isPublic,
            publishedAt: output.publishedAt,
            publicTitle: output.publicTitle
          }
        ]
      : []
  );
}

function combineRecentResults(primary: GalleryImageItem[], secondary: GalleryImageItem[]): GalleryImageItem[] {
  const seen = new Set<string>();
  const results: GalleryImageItem[] = [];

  for (const item of [...primary, ...secondary]) {
    if (seen.has(item.outputId)) {
      continue;
    }
    seen.add(item.outputId);
    results.push(item);
    if (results.length >= SIMPLE_RESULT_LIMIT) {
      break;
    }
  }

  return results;
}

function sizePresetLabel(preset: SizePreset, t: ReturnType<typeof useI18n>["t"]): string {
  return t("sizePresetLabel", { presetId: preset.id, fallback: preset.label });
}

function sizePresetOptionLabel(preset: SizePreset, t: ReturnType<typeof useI18n>["t"]): string {
  return `${sizePresetLabel(preset, t)} - ${preset.width} x ${preset.height}`;
}

function normalizeDimension(value: string): number {
  return Number.parseInt(value, 10);
}

async function waitForGenerationPollInterval(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, GENERATION_POLL_INTERVAL_MS);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Generation polling aborted.", "AbortError"));
      },
      { once: true }
    );
  });
}
