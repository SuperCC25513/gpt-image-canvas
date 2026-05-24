import {
  ArrowRight,
  CheckCircle2,
  Globe2,
  ImageIcon,
  Sparkles,
  Square,
  Video,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PromptPoolItem, PromptPoolResponse } from "@gpt-image-canvas/shared";
import { useI18n } from "../../shared/i18n";
import {
  filterPromptPoolItems,
  readPromptPoolFilterState,
  type PromptPoolFilterState,
  type PromptPoolMediaFilter,
  type PromptPoolSortMode
} from "../pool/promptPoolFilters";

const HOME_PREVIEW_ITEMS = 3;

interface HomePageProps {
  authError: string;
  onOpenCanvas: () => void;
  onOpenGenerate: () => void;
  onOpenPool: () => void;
  onOpenPublicGallery: () => void;
}

export function HomePage({
  authError,
  onOpenCanvas,
  onOpenGenerate,
  onOpenPool,
  onOpenPublicGallery
}: HomePageProps) {
  const { t } = useI18n();
  const [promptPoolItems, setPromptPoolItems] = useState<PromptPoolItem[]>([]);
  const [promptPoolFilters] = useState<PromptPoolFilterState>(readPromptPoolFilterState);
  const [isPromptPoolLoading, setIsPromptPoolLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPromptPoolPreview(): Promise<void> {
      setIsPromptPoolLoading(true);

      try {
        const response = await fetch("/api/pool", {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("prompt pool preview unavailable");
        }

        const body = (await response.json()) as unknown;
        if (!isPromptPoolResponse(body)) {
          throw new Error("prompt pool preview invalid");
        }

        if (!controller.signal.aborted) {
          setPromptPoolItems(body.items);
        }
      } catch {
        if (!controller.signal.aborted) {
          setPromptPoolItems([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsPromptPoolLoading(false);
        }
      }
    }

    void loadPromptPoolPreview();

    return () => {
      controller.abort();
    };
  }, []);

  const startCards = useMemo(
    () => [
      {
        action: onOpenGenerate,
        button: t("homePathGenerateAction"),
        copy: t("homePathGenerateCopy"),
        Icon: Sparkles,
        title: t("homePathGenerateTitle")
      },
      {
        action: onOpenCanvas,
        button: t("homePathCanvasAction"),
        copy: t("homePathCanvasCopy"),
        Icon: Square,
        title: t("homePathCanvasTitle")
      },
      {
        action: onOpenPublicGallery,
        button: t("homePathPublicAction"),
        copy: t("homePathPublicCopy"),
        Icon: Globe2,
        title: t("homePathPublicTitle")
      }
    ],
    [onOpenCanvas, onOpenGenerate, onOpenPublicGallery, t]
  );
  const useCases = useMemo(
    () => [
      t("homeUseCaseAvatar"),
      t("homeUseCaseProduct"),
      t("homeUseCaseCover"),
      t("homeUseCaseInterior"),
      t("homeUseCaseWallpaper")
    ],
    [t]
  );
  const poolSortLabel = promptPoolSortLabel(promptPoolFilters.sortMode, t);
  const poolModelLabel = promptPoolFilters.modelFilter === "all" ? t("poolAllModels") : promptPoolFilters.modelFilter;
  const poolMediaLabel = promptPoolMediaLabel(promptPoolFilters.mediaFilter, t);
  const promptPreviewItems = useMemo<PromptPoolItem[]>(() => {
    const filteredItems = filterPromptPoolItems(
      promptPoolItems,
      "",
      promptPoolFilters.mediaFilter,
      promptPoolFilters.modelFilter,
      promptPoolFilters.sortMode
    );
    const sourceItems =
      filteredItems.length > 0
        ? filteredItems
        : filterPromptPoolItems(promptPoolItems, "", "all", "all", promptPoolFilters.sortMode);

    return sourceItems.filter((item) => item.assetUrl.trim()).slice(0, HOME_PREVIEW_ITEMS);
  }, [promptPoolFilters.mediaFilter, promptPoolFilters.modelFilter, promptPoolFilters.sortMode, promptPoolItems]);
  const hasPromptPoolPreview = promptPreviewItems.length > 0;
  const promptPoolPreviewStatus = isPromptPoolLoading
    ? t("poolLoading")
    : hasPromptPoolPreview
      ? t("homePromptPoolPreviewFilter", { model: poolModelLabel, sort: poolSortLabel })
      : t("homePromptPoolPreviewFallback");
  const promptPoolFilterChips = [poolModelLabel, poolSortLabel, poolMediaLabel];

  return (
    <main className="home-page app-view" data-testid="home-page">
      <section className="home-consumer-hero" aria-labelledby="home-title">
        <div className="home-consumer-hero__copy">
          <p className="home-consumer-kicker">
            <Sparkles className="size-4" aria-hidden="true" />
            {t("homeConsumerKicker")}
          </p>
          <h1 id="home-title">{t("homeConsumerTitle")}</h1>
          <p className="home-consumer-deck">{t("homeConsumerDeck")}</p>

          <div className="home-consumer-actions" aria-label={t("homeEntryAria")}>
            <button className="home-action home-action--primary" data-testid="home-generate-link" type="button" onClick={onOpenGenerate}>
              <Sparkles className="size-4" aria-hidden="true" />
              {t("homeStartGenerate")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            <button className="home-action" data-testid="home-canvas-link" type="button" onClick={onOpenCanvas}>
              <Square className="size-4" aria-hidden="true" />
              {t("homeOpenCanvas")}
            </button>
            <button className="home-action home-action--quiet" data-testid="home-public-gallery-link" type="button" onClick={onOpenPublicGallery}>
              <Globe2 className="size-4" aria-hidden="true" />
              {t("homeOpenPublicGallery")}
            </button>
          </div>

          {authError ? (
            <p className="home-auth-error" role="alert">
              {t("homeCreationBlocked")}
            </p>
          ) : null}

          <div className="home-usecase-row" aria-label={t("homeUseCaseAria")}>
            {useCases.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>

        <button
          aria-label={t("homePromptPoolPreviewOpenPromptPool")}
          className="home-inspiration-board"
          data-loading={isPromptPoolLoading}
          data-testid="home-inspiration-board"
          type="button"
          onClick={onOpenPool}
        >
          <span className="home-inspiration-board__header">
            <span>
              <span className="home-section-kicker">{t("homePromptPoolPreviewKicker")}</span>
              <strong>{t("homePromptPoolPreviewTitle")}</strong>
            </span>
            <span className="home-inspiration-board__status">
              {promptPoolPreviewStatus}
            </span>
          </span>

          <span className="home-inspiration-preview" aria-hidden="true">
            <span className="home-inspiration-preview__copy">{t("homePromptPoolPreviewCopy")}</span>
            <span className="home-prompt-preview-grid">
              {hasPromptPoolPreview ? (
                promptPreviewItems.map((item, index) => (
                  <span className="home-prompt-preview-card" key={item.id}>
                    <img
                      alt=""
                      className="home-prompt-preview-card__image"
                      decoding={index === 0 ? "sync" : "async"}
                      height={item.imageHeight}
                      loading={index === 0 ? "eager" : "lazy"}
                      referrerPolicy="no-referrer"
                      src={item.assetUrl}
                      width={item.imageWidth}
                    />
                    <span className="home-prompt-preview-card__shade" />
                    <span className="home-prompt-preview-card__badges">
                      <span className="home-prompt-preview-card__badge">
                        {item.mediaType === "video" ? (
                          <Video className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ImageIcon className="size-3.5" aria-hidden="true" />
                        )}
                        {promptPoolMediaLabel(item.mediaType, t)}
                      </span>
                      {item.imageCount > 1 ? <span className="home-prompt-preview-card__badge">+{item.imageCount - 1}</span> : null}
                    </span>
                    <span className="home-prompt-preview-card__copy">
                      <strong>{compactIdeaText(item.title || item.prompt, 42)}</strong>
                      <span>
                        {item.model} · {item.promptReady ? t("poolPromptReady") : t("poolPromptDraft")}
                      </span>
                    </span>
                  </span>
                ))
              ) : (
                <span className="home-inspiration-empty">{t("poolEmptyHint")}</span>
              )}
            </span>
            <span className="home-inspiration-preview__tags">
              {promptPoolFilterChips.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </span>
          </span>

          <span className="home-inspiration-board__cta">
            <WandSparkles className="size-4" aria-hidden="true" />
            {t("homePromptPoolPreviewOpen")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </span>
        </button>
      </section>

      <section className="home-start-section" aria-labelledby="home-start-title">
        <div className="home-section-heading">
          <p className="home-section-kicker">{t("homePathKicker")}</p>
          <h2 id="home-start-title">{t("homePathTitle")}</h2>
          <p>{t("homePathDeck")}</p>
        </div>

        <div className="home-start-grid">
          {startCards.map(({ action, button, copy, Icon, title }) => (
            <article className="home-start-card" key={title}>
              <span className="home-start-card__icon" aria-hidden="true">
                <Icon className="size-5" />
              </span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <button className="home-start-card__button" type="button" onClick={action}>
                {button}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="home-inspire-strip" aria-label={t("homeInspireAria")}>
        <CheckCircle2 className="size-4" aria-hidden="true" />
        <span>{t("homeInspireLine")}</span>
      </section>
    </main>
  );
}

function isPromptPoolResponse(value: unknown): value is PromptPoolResponse {
  return typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items);
}

function promptPoolSortLabel(sortMode: PromptPoolSortMode, t: ReturnType<typeof useI18n>["t"]): string {
  if (sortMode === "popular") {
    return t("poolSortPopular");
  }

  if (sortMode === "ready") {
    return t("poolSortReady");
  }

  return t("poolSortLatest");
}

function promptPoolMediaLabel(mediaFilter: PromptPoolMediaFilter, t: ReturnType<typeof useI18n>["t"]): string {
  if (mediaFilter === "image") {
    return t("poolMediaImage");
  }

  if (mediaFilter === "video") {
    return t("poolMediaVideo");
  }

  return t("poolAllMedia");
}

function compactIdeaText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}
