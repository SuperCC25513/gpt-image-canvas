import {
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Globe2,
  History,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Settings2,
  Sparkles,
  Square,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import {
  CUSTOM_SIZE_PRESET_ID,
  DEFAULT_GENERATION_CREDIT_COST,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  IMAGE_QUALITIES,
  MAX_REFERENCE_IMAGES,
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
  type ReferenceImageInput,
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
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

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

interface SimpleReferenceImage {
  dataUrl: string;
  fileName: string;
  id: string;
  mimeType: string;
  sizeBytes: number;
}

interface SimplePresetCardItem {
  count: number;
  description: string;
  imageHeight?: number;
  imageUrl?: string;
  imageWidth?: number;
  key: string;
  prompt: string;
  ratio: string;
  title: string;
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
  const publishGeneration = true;
  const [referenceImages, setReferenceImages] = useState<SimpleReferenceImage[]>([]);
  const [galleryItems, setGalleryItems] = useState<GalleryImageItem[]>([]);
  const [sessionItems, setSessionItems] = useState<GalleryImageItem[]>([]);
  const [latestRecord, setLatestRecord] = useState<GenerationRecord | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [isGalleryLoading, setIsGalleryLoading] = useState(true);
  const [galleryError, setGalleryError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationWarning, setGenerationWarning] = useState("");
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const [privacyNoticeVisible, setPrivacyNoticeVisible] = useState(false);
  const copiedTimerRef = useRef<number | undefined>();
  const privacyNoticeTimerRef = useRef<number | undefined>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const presetApplyTokenRef = useRef(0);
  const stageRef = useRef<HTMLElement | null>(null);

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
      window.clearTimeout(privacyNoticeTimerRef.current);
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
  const missingPromptMessage = trimmedPrompt ? "" : t("promptRequired");
  const passiveValidationMessage =
    dimensionValidationMessage || authError || providerValidationMessage || accountValidationMessage || creditValidationMessage;
  const validationMessage = missingPromptMessage || passiveValidationMessage;
  const canGenerate = !validationMessage && !isGenerating;
  const visibleResults = useMemo(() => combineRecentResults(sessionItems, galleryItems), [galleryItems, sessionItems]);
  const presetCards = simplePresetCards;
  const selectedResult = useMemo(
    () => (selectedOutputId ? visibleResults.find((item) => item.outputId === selectedOutputId) ?? null : null),
    [selectedOutputId, visibleResults]
  );
  const stageResults = selectedResult ? [selectedResult] : [];
  const latestAssets = latestRecord ? generatedAssetsForRecord(latestRecord) : [];
  const selectedRecordAssets = selectedResult?.generationId === latestRecord?.id ? latestAssets : [];
  const isReferenceMode = referenceImages.length > 0;
  const submitLabel = isReferenceMode ? t("simpleGenerationSubmitEdit") : t("simpleGenerationSubmit");

  useEffect(() => {
    if (selectedOutputId === null) {
      return;
    }

    const currentSelection = visibleResults.find((item) => item.outputId === selectedOutputId);
    if (!currentSelection) {
      setSelectedOutputId(null);
    }
  }, [selectedOutputId, visibleResults]);

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

  function scrollStageToTop(): void {
    stageRef.current?.scrollTo({ top: 0 });
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

  async function applyPresetCard(starter: SimplePresetCardItem): Promise<void> {
    const applyToken = presetApplyTokenRef.current + 1;
    presetApplyTokenRef.current = applyToken;
    setPrompt(starter.prompt);
    setSelectedOutputId(null);
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage("");
    if (generationCountOptions.includes(starter.count as GenerationCount)) {
      setCount(starter.count as GenerationCount);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (!starter.imageUrl) {
      setReferenceImages([]);
      return;
    }

    try {
      const presetReference = await readPresetReferenceImage(starter, t);
      if (presetApplyTokenRef.current !== applyToken) {
        return;
      }
      setReferenceImages([presetReference]);
    } catch (error) {
      if (presetApplyTokenRef.current !== applyToken) {
        return;
      }
      setReferenceImages([]);
      setGenerationWarning(error instanceof Error ? error.message : t("readReferenceDataFailed"));
    }
  }

  function resetComposer(): void {
    setSelectedOutputId(null);
    setPrompt("");
    setReferenceImages([]);
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    scrollStageToTop();
  }

  function showPrivacyLockedNotice(): void {
    window.clearTimeout(privacyNoticeTimerRef.current);
    setPrivacyNoticeVisible(true);
    privacyNoticeTimerRef.current = window.setTimeout(() => setPrivacyNoticeVisible(false), 2200);
  }

  function selectResultTask(item: GalleryImageItem): void {
    setSelectedOutputId(item.outputId);
    setPrompt(item.prompt);
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage("");
    scrollStageToTop();
  }

  async function appendReferenceFiles(files: File[]): Promise<void> {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setGenerationWarning(t("referenceInvalidType"));
      return;
    }

    const availableSlots = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (availableSlots <= 0) {
      setGenerationWarning(t("simpleGenerationReferenceLimit", { max: MAX_REFERENCE_IMAGES }));
      return;
    }

    const selectedFiles = imageFiles.slice(0, availableSlots);
    try {
      const nextReferences = await Promise.all(selectedFiles.map((file) => readLocalReferenceImage(file, t)));
      setReferenceImages((current) => [...current, ...nextReferences]);
      setGenerationError("");
      setGenerationWarning(
        imageFiles.length > availableSlots ? t("simpleGenerationReferenceLimit", { max: MAX_REFERENCE_IMAGES }) : ""
      );
      setGenerationMessage("");
    } catch (error) {
      setGenerationWarning(error instanceof Error ? error.message : t("readReferenceDataFailed"));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handlePromptPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void appendReferenceFiles(imageFiles);
  }

  function removeReferenceImage(referenceId: string): void {
    setReferenceImages((current) => current.filter((reference) => reference.id !== referenceId));
    setGenerationWarning("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
      const requestBody: Record<string, unknown> = {
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
      };

      if (isReferenceMode) {
        requestBody.referenceImages = referenceImages.map(referenceImageToInput);
      }

      const response = await fetch(isReferenceMode ? "/api/images/edit" : "/api/images/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
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
      setSelectedOutputId(successfulItems[0].outputId);
      scrollStageToTop();
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
    if (selectedRecordAssets.length === 0) {
      setGenerationWarning(t("simpleGenerationNoCanvasAssets"));
      return;
    }

    onContinueOnCanvas({
      assets: selectedRecordAssets,
      prompt: selectedResult?.prompt ?? latestRecord?.prompt ?? prompt
    });
  }

  return (
    <main className="simple-generation-page app-view" data-testid="simple-generation-page">
      <section className="simple-workbench-shell" aria-labelledby="simple-generation-title">
        <aside className="simple-workbench-sidebar" aria-label={t("simpleGenerationRecentTitle")}>
          <div className="simple-sidebar-actions">
            <button className="simple-new-button" type="button" onClick={resetComposer}>
              <MessageSquarePlus className="size-4" aria-hidden="true" />
              {t("simpleGenerationNewDraft")}
            </button>
            <button className="simple-sidebar-icon" type="button" title={t("simpleGenerationViewMore")} onClick={onOpenGallery}>
              <History className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="simple-sidebar-list">
            {isGalleryLoading && visibleResults.length === 0 ? (
              <p className="simple-sidebar-empty" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("simpleGenerationResultsLoading")}
              </p>
            ) : visibleResults.length > 0 ? (
              visibleResults.map((item) => (
                <button
                  aria-pressed={selectedOutputId === item.outputId}
                  className="simple-sidebar-item"
                  data-active={selectedOutputId === item.outputId}
                  key={item.outputId}
                  type="button"
                  onClick={() => selectResultTask(item)}
                >
                  <span>{item.prompt}</span>
                  <small>{item.size.width} x {item.size.height}</small>
                </button>
              ))
            ) : (
              <p className="simple-sidebar-empty">{t("simpleGenerationHistoryEmpty")}</p>
            )}
          </div>
        </aside>

        <div className="simple-workbench-main">
          <section ref={stageRef} className="simple-workbench-stage" aria-labelledby="simple-generation-title">
            {stageResults.length > 0 ? (
              <div className="simple-results-stage" data-testid="simple-results-panel">
                <div className="simple-results-stage__header">
                  <div>
                    <p className="control-label">{t("simpleGenerationSelectedTaskKicker")}</p>
                    <h1 id="simple-generation-title">{t("simpleGenerationResultsTitle")}</h1>
                  </div>
                  <button className="secondary-action simple-results-stage__more" type="button" onClick={onOpenGallery}>
                    {t("simpleGenerationViewMore")}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                </div>

                {selectedRecordAssets.length > 0 ? (
                  <div className="simple-canvas-prompt" role="status">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    <span>{t("simpleGenerationCanvasHint", { count: selectedRecordAssets.length })}</span>
                    <button className="secondary-action" type="button" onClick={continueLatestOnCanvas}>
                      <Square className="size-4" aria-hidden="true" />
                      {t("simpleGenerationContinueCanvas")}
                    </button>
                  </div>
                ) : null}

                <div className="simple-results-grid" data-count={stageResults.length} data-testid="simple-results-grid">
                  {stageResults.map((item) => (
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

                {galleryError ? (
                  <p className="simple-results-warning" role="alert">
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    {galleryError}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="simple-empty-state">
                <p className="simple-generation-kicker">
                  <Sparkles className="size-4" aria-hidden="true" />
                  {isReferenceMode ? t("simpleGenerationReferenceMode") : t("simpleGenerationTextMode")}
                </p>
                <h1 id="simple-generation-title">{t("simpleGenerationEmptyTitle")}</h1>
                <p>{galleryError || t("simpleGenerationEmptyDeck")}</p>
                <div className="simple-empty-presets" data-testid="simple-prompt-starters">
                  {presetCards.map((starter, index) => (
                    <button
                      className="simple-preset-card"
                      data-media={starter.imageUrl ? "image" : "text"}
                      key={starter.key}
                      title={starter.description}
                      type="button"
                      onClick={() => void applyPresetCard(starter)}
                    >
                      <span className="simple-preset-card__preview" aria-hidden="true">
                        {starter.imageUrl ? (
                          <img
                            alt=""
                            className="simple-preset-card__image"
                            decoding={index === 0 ? "sync" : "async"}
                            height={starter.imageHeight}
                            loading={index === 0 ? "eager" : "lazy"}
                            referrerPolicy="no-referrer"
                            src={starter.imageUrl}
                            width={starter.imageWidth}
                          />
                        ) : (
                          <span className="simple-preset-card__text-preview">{starter.prompt}</span>
                        )}
                        <span className="simple-preset-card__meta">
                          <span>{starter.ratio}</span>
                          <span>{starter.count}</span>
                        </span>
                      </span>
                      <span className="simple-preset-card__title">{starter.title}</span>
                      <small>{starter.description}</small>
                      <strong>{t("simpleGenerationApplyPreset")}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <form
            className="simple-composer"
            data-testid="simple-generation-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitGeneration();
            }}
          >
            <input
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="sr-only"
              multiple
              type="file"
              onChange={(event) => {
                void appendReferenceFiles(Array.from(event.target.files ?? []));
              }}
            />

            {referenceImages.length > 0 ? (
              <div className="simple-reference-strip" aria-label={t("simpleGenerationReferenceList")} role="list">
                {referenceImages.map((reference) => (
                  <figure className="simple-reference-thumb" key={reference.id} role="listitem">
                    <img alt={reference.fileName} src={reference.dataUrl} />
                    <figcaption>{reference.fileName}</figcaption>
                    <button type="button" title={t("simpleGenerationRemoveReference", { name: reference.fileName })} onClick={() => removeReferenceImage(reference.id)}>
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </figure>
                ))}
              </div>
            ) : null}

            <div className="simple-composer__surface">
              <textarea
                id="simple-generation-prompt-input"
                aria-invalid={Boolean(generationError || generationWarning || passiveValidationMessage)}
                aria-describedby="simple-prompt-hint"
                className="prompt-textarea simple-generation-prompt"
                placeholder={isReferenceMode ? t("simpleGenerationEditPlaceholder") : t("simpleGenerationPromptPlaceholder")}
                value={prompt}
                data-testid="simple-generation-prompt"
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={handlePromptPaste}
              />
              <p id="simple-prompt-hint" className="sr-only">
                {t("simpleGenerationPromptHint")}
              </p>

              <div className="simple-composer__footer">
                <div className="simple-composer__tools">
                  <button
                    className="simple-tool-chip"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="size-4" aria-hidden="true" />
                    {referenceImages.length > 0 ? t("simpleGenerationAddReference") : t("simpleGenerationUploadReference")}
                  </button>

                  <CreditSummary
                    accountCredits={accountUser?.credits}
                    cost={estimatedCreditCost}
                    error={accountError || accountValidationMessage || creditValidationMessage}
                    isLoading={isAccountLoading}
                    maxImages={maxImagesPerRequest}
                    perImageCost={generationCreditCost}
                  />

                  <div className="simple-count-chip" data-testid="simple-count-grid">
                    <span>{t("simpleGenerationCountChip")}</span>
                    {generationCountOptions.map((item) => (
                      <button
                        aria-pressed={item === count}
                        className={item === count ? "is-active" : ""}
                        key={item}
                        type="button"
                        onClick={() => setCount(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>

                  <label className="simple-select-chip">
                    <span>{t("simpleGenerationSizeChip")}</span>
                    <select
                      value={sizePresetId}
                      data-testid="simple-size-preset-select"
                      onChange={(event) => selectSizePreset(event.target.value)}
                    >
                      {SIZE_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {sizePresetLabel(preset, t)}
                        </option>
                      ))}
                      <option value={CUSTOM_SIZE_PRESET_ID}>{t("customSizeOption")}</option>
                    </select>
                  </label>

                  <label className="simple-select-chip">
                    <span>{t("simpleGenerationStyleChip")}</span>
                    <select
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

                  <div className="simple-publish-control">
                    <button
                      aria-label={t("simpleGenerationPublicOnlyNotice")}
                      className="simple-publish-chip"
                      data-enabled="true"
                      data-testid="simple-generation-public-toggle"
                      type="button"
                      onClick={showPrivacyLockedNotice}
                    >
                      <Globe2 className="size-4" aria-hidden="true" />
                      <span>{t("simpleGenerationPublicShort")}</span>
                    </button>
                    {privacyNoticeVisible ? (
                      <span className="simple-publish-popover" role="alert">
                        {t("simpleGenerationPublicOnlyNotice")}
                      </span>
                    ) : null}
                  </div>

                  <details className="simple-composer-settings">
                    <summary>
                      <Settings2 className="size-4" aria-hidden="true" />
                      {t("simpleGenerationParameters")}
                      <ChevronDown className="simple-composer-settings__icon size-4" aria-hidden="true" />
                    </summary>
                    <div className="simple-composer-settings__panel">
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

                  <span className="simple-provider-chip" title={providerDetails.copy}>
                    <Sparkles className="size-4" aria-hidden="true" />
                    {providerDetails.title}
                  </span>
                </div>

                <button
                  aria-label={submitLabel}
                  className="simple-submit-button"
                  data-invalid={Boolean(validationMessage)}
                  data-testid="simple-generate-button"
                  disabled={isGenerating}
                  title={validationMessage || submitLabel}
                  type="submit"
                >
                  {isGenerating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className="simple-composer__meta">
              <span>{isReferenceMode ? t("simpleGenerationReferenceMode") : t("simpleGenerationTextMode")}</span>
              <span>{width} x {height}</span>
              <span>{estimatedCreditCost > 0 ? t("creditsEstimatedCost", { cost: estimatedCreditCost }) : t("creditsEstimatedFree")}</span>
              <span>{t("creditsBalance", { credits: accountUser?.credits ?? 0 })}</span>
              <span>{t("simpleGenerationPromptCount", { count: prompt.length })}</span>
              {referenceImages.length > 0 ? <span>{t("simpleGenerationReferenceCount", { count: referenceImages.length, max: MAX_REFERENCE_IMAGES })}</span> : null}
            </div>

            <StatusMessage
              error={generationError}
              isGenerating={isGenerating}
              message={generationMessage}
              warning={generationWarning || passiveValidationMessage}
            />
          </form>
        </div>
      </section>
    </main>
  );
}

const simplePresetCards: SimplePresetCardItem[] = [
  {
    count: 1,
    description: "高审美叙事海报、角色宇宙主题视觉、收藏版概念海报。",
    imageHeight: 720,
    imageUrl: "/simple-presets/stellar-poster.webp",
    imageWidth: 405,
    key: "reference-stellar-poster",
    prompt: [
      "请根据【主题：崩坏星穹铁道，角色卡芙卡】自动生成一张高审美的“轮廓宇宙 / 收藏版叙事海报”风格作品。",
      "不要将画面局限于固定器物或常见容器，不要优先默认瓶子、沙漏、玻璃罩、怀表之类的常规载体，而是由 AI 根据主题自行判断并选择一个最契合、最有象征意义、轮廓最强、最适合承载完整叙事世界的主轮廓载体。",
      "这个主轮廓可以是器物、建筑、门、塔、拱门、穹顶、楼梯井、长廊、雕像、侧脸、眼睛、手掌、头骨、羽翼、面具、镜面、王座、圆环、裂缝、光幕、阴影、几何结构、空间切面、舞台框景、抽象符号或其他更有创意与主题代表性的视觉轮廓，要求合理布局。",
      "优先选择最能放大主题气质、最能形成强烈视觉记忆点、最能体现史诗感、神秘感、诗意感或设计感的轮廓，而不是最安全、最普通、最常见的容器。",
      "画面的核心不是简单把世界装进某个物体里，而是让完整的主题世界自然生长在这个主轮廓之中、之内、之上、之边界里或与其结构融为一体，形成一种“主题宇宙依附于一个象征性轮廓展开”的高级叙事效果。",
      "主轮廓必须清晰、优雅、有辨识度，并在整体构图中占据核心地位。",
      "轮廓内部或边界中需要自动生成与主题强绑定的完整叙事世界，内容应当丰富、饱满、层次清晰，包括最能代表主题的标志性场景、核心建筑或空间结构、象征符号与隐喻元素、角色关系或文明痕迹、远景中景近景的空间递进、具有命运感和情绪张力的氛围层次，以及门、台阶、桥梁、水面、烟雾、路径、光源、遗迹、机械结构、自然景观、抽象形态、生物或道具等叙事细节。",
      "所有元素必须统一、自然、有主次、有层级地融合，像一个完整世界真实孕育在这个轮廓结构之中，而不是简单拼贴、裁切填充、素材堆叠或模板化背景。",
      "整体构图需要具有强烈的收藏版海报气质与高级设计感，大结构稳定，主轮廓强烈明确，内部世界具有纵深、秩序和呼吸感，细节丰富但不拥挤，内容丰满但不杂乱，可以适度加入小比例人物剪影、远处建筑、光柱、门洞、桥、阶梯、回廊、倒影、天光或远景结构来增强尺度感、故事感与史诗感。",
      "整体画面要安静、宏大、凝练、富有余味，不要平均铺满，不要廉价热闹，不要无重点堆砌。",
      "风格融合收藏版电影海报构图、高级叙事型视觉设计、梦幻水彩质感与纸张印刷品气质，强调纸张颗粒感、边缘飞白、水彩刷痕、轻微晕染、空气透视、柔和雾化、局部体积光、光雾穿透、大面积留白与克制版式，让画面看起来像设计师完成的高端收藏版视觉作品，而不是普通 AI 跑图。",
      "整体气质要高级、诗意、宏大、神圣、怀旧、安静、具有传说感和叙事感。",
      "色彩由 AI 根据主题自动判断并匹配最合适的高级配色方案，但必须保持统一、克制、耐看、低饱和、高级，不要杂乱高饱和，不要廉价霓虹感，不要塑料数码感。",
      "配色可以围绕黑金灰、冷蓝灰、雾白灰、褐红米白、暗铜、旧纸色、深海蓝、暮色紫、银灰等体系自由变化，但必须始终服务主题，并保持海报级审美与整体和谐。",
      "最终要求：第一眼有强烈的主题识别度和轮廓记忆点，第二眼有完整丰富的叙事世界，第三眼仍有细节和余味。",
      "轮廓选择必须具有创意和主题匹配度，尽量避免重复、保守、常见的容器套路，优先选择更有象征性、更有空间感、更有设计潜力的轮廓形式。",
      "不要普通背景拼接，不要生硬裁切，不要模板化奇幻素材，不要游戏宣传图感，不要过度卡通化，不要过度写实导致失去艺术感，不要形式大于内容。",
      "如果合适，可以自然加入低调克制的标题、编号、签名或落款，让它更像收藏版海报设计的一部分，但不要喧宾夺主。"
    ].join(""),
    ratio: "9:16",
    title: "轮廓宇宙海报"
  },
  {
    count: 1,
    description: "文博专题、器物拆解、中文信息图和展板式视觉。",
    imageHeight: 576,
    imageUrl: "/simple-presets/qinghua-museum-infographic.webp",
    imageWidth: 720,
    key: "reference-qinghua-museum-infographic",
    prompt: [
      "请根据“青花瓷”自动生成一张“博物馆图鉴式中文拆解信息图”。",
      "要求整张图兼具真实写实主视觉、结构拆解、中文标注、材质说明、纹样寓意、色彩含义和核心特征总结。",
      "你需要根据主题自动判断最合适的主体对象、服饰体系、器物结构、时代风格、关键部件、材质工艺、颜色方案与版式结构，用户无需再提供其他信息。",
      "整体风格应为：国家博物馆展板、历史服饰图鉴、文博专题信息图，而不是普通海报、古风写真、电商详情页或动漫插画。",
      "背景采用米白、绢纸白、浅茶色等纸张质感，整体高级、克制、专业、可收藏。",
      "版式固定为：顶部：中文主标题 + 副标题 + 导语；左侧：结构拆解区，中文引线标注关键部件，并配局部特写；右上：材质 / 工艺 / 质感区，展示真实纹理小样并附说明；右中：纹样 / 色彩 / 寓意区，展示主色板、纹样样本和文化解释；底部：穿着顺序 / 构成流程图 + 核心特征总结。",
      "若主题适合人物展示，则以真实人物全身站姿为中央主体；若更适合器物或单体结构，则改为中心主体拆解图，但整体仍保持完整中文信息图形式。",
      "所有文字必须为简体中文，清晰、规整、可读，不要乱码、错字、英文或拼音。",
      "重点突出真实结构、材质差异、文化说明与图鉴气质。",
      "避免：海报感、影楼感、电商感、动漫感、cosplay感、乱标注、错结构、糊字、假材质、过度装饰。"
    ].join(""),
    ratio: "4:3",
    title: "青花瓷博物馆图鉴"
  },
  {
    count: 1,
    description: "古风角色联动、游戏活动主视觉、电影感人物宣传图。",
    imageHeight: 720,
    imageUrl: "/simple-presets/editorial-fashion.webp",
    imageWidth: 405,
    key: "reference-editorial-fashion",
    prompt: "《倚天屠龙记》周芷若的维秘联动活动宣传图，人物占画面 80% 以上，周芷若在古风古城城墙上，优雅侧身回眸姿态，突出古典美人身姿曲线，穿着维秘联动款：融合古风元素的蕾丝吊带裙，搭配精致吊带丝袜（黑色或淡青色，带有轻微古风刺绣），丝袜包裹修长双腿，整体造型唯美古典。高品质真人级 3D 古风游戏截图风格，电影级光影，周芷若清丽绝俗、长发微散，眼神柔美回眸，轻纱飘逸。背景为夜晚古城墙，青砖城垛、灯笼照明、月光洒落，古建筑灯火点点，氛围梦幻唯美。高细节，8K 品质，精致渲染，真实丝袜质感，电影级构图，光影细腻，古典武侠风。",
    ratio: "9:16",
    title: "古风联动宣传图"
  },
  {
    count: 1,
    description: "游戏主视觉、次世代赛车截图、城市宣传感概念图。",
    imageHeight: 405,
    imageUrl: "/simple-presets/forza-horizon-shenzhen.webp",
    imageWidth: 720,
    key: "reference-forza-horizon-shenzhen",
    prompt: "创作一张图片为《极限竞速 地平线 8》的游戏实机截图，游戏背景设为中国，背景城市为深圳，时间设定为 2028 年。画面需要体现真实次世代开放世界赛车游戏的实机演出效果，包含具有深圳辨识度的城市天际线、现代高楼、道路环境、灯光氛围与速度感。构图中在合适位置放置《极限竞速 地平线 8》的 logo 及宣传文案，整体像官方概念宣传截图而不是普通海报。要求 8K 超高清，电影级光影，真实车辆材质、反射、路面细节与空气透视，画面高级、震撼、写实。",
    ratio: "16:9",
    title: "地平线深圳实机图"
  }
];

async function readLocalReferenceImage(file: File, t: ReturnType<typeof useI18n>["t"]): Promise<SimpleReferenceImage> {
  if (!isSupportedReferenceImageType(file.type)) {
    throw new Error(t("referenceInvalidType"));
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(t("referenceFileTooLarge"));
  }

  return {
    dataUrl: await blobToDataUrl(file, t),
    fileName: fileNameWithImageExtension(file.name || "reference", file.type),
    id: createReferenceId(),
    mimeType: file.type,
    sizeBytes: file.size
  };
}

async function readPresetReferenceImage(starter: SimplePresetCardItem, t: ReturnType<typeof useI18n>["t"]): Promise<SimpleReferenceImage> {
  if (!starter.imageUrl) {
    throw new Error(t("readReferenceDataFailed"));
  }

  const response = await fetch(starter.imageUrl);
  if (!response.ok) {
    throw new Error(t("readReferenceDataFailed"));
  }

  const blob = await response.blob();
  const mimeType = normalizeImageMimeType(blob.type || imageMimeTypeFromUrl(starter.imageUrl));
  if (!isSupportedReferenceImageType(mimeType)) {
    throw new Error(t("referenceInvalidType"));
  }
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(t("referenceFileTooLarge"));
  }

  return {
    dataUrl: await blobToDataUrl(blob, t),
    fileName: fileNameWithImageExtension(starter.title || starter.key, mimeType),
    id: createReferenceId(),
    mimeType,
    sizeBytes: blob.size
  };
}

function referenceImageToInput(reference: SimpleReferenceImage): ReferenceImageInput {
  return {
    dataUrl: reference.dataUrl,
    fileName: reference.fileName
  };
}

function createReferenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileNameWithImageExtension(name: string, mimeType: string): string {
  if (/\.(png|jpe?g|webp)$/iu.test(name)) {
    return name;
  }

  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `${name}.${extension}`;
}

function isSupportedReferenceImageType(mimeType: string): boolean {
  return SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType.toLowerCase());
}

function imageMimeTypeFromUrl(url: string): string {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".webp")) {
    return "image/webp";
  }
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (path.endsWith(".png")) {
    return "image/png";
  }
  return "";
}

function normalizeImageMimeType(mimeType: string): string {
  return mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : mimeType.toLowerCase();
}

async function blobToDataUrl(blob: Blob, t: ReturnType<typeof useI18n>["t"]): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("readReferenceDataFailed")));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(t("readReferenceDataFailed")));
    };
    reader.readAsDataURL(blob);
  });
}

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
  const title = `${cost > 0 ? t("creditsEstimatedCost", { cost }) : t("creditsEstimatedFree")} · ${t("creditsPerImage", { cost: perImageCost })} · ${t("creditsMaxImages", { max: maxImages })}`;

  return (
    <div className="simple-credit-summary" data-warning={Boolean(error)} title={error || title}>
      <span>{cost > 0 ? t("creditsEstimatedCost", { cost }) : t("creditsEstimatedFree")}</span>
      <strong>{isLoading ? t("commonNotSet") : t("creditsBalance", { credits: accountCredits ?? 0 })}</strong>
      {error ? <small role="alert">{error}</small> : null}
    </div>
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
