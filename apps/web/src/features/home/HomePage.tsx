import {
  ArrowRight,
  CheckCircle2,
  Globe2,
  Sparkles,
  Square,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PromptPoolItem, PromptPoolResponse } from "@gpt-image-canvas/shared";
import { useI18n } from "../../shared/i18n";
import {
  filterPromptPoolItems,
  type PromptPoolMediaFilter,
  type PromptPoolSortMode
} from "../pool/promptPoolFilters";

const HOME_PREVIEW_ITEMS = 2;
const HOME_PROMPT_PREVIEW_MODEL = "GPT Image";
const HOME_PROMPT_PREVIEW_MEDIA: PromptPoolMediaFilter = "image";
const HOME_PROMPT_PREVIEW_SORT: PromptPoolSortMode = "popular";

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
  const promptPreviewItems = useMemo<PromptPoolItem[]>(() => {
    const filteredItems = filterPromptPoolItems(
      promptPoolItems,
      "",
      HOME_PROMPT_PREVIEW_MEDIA,
      HOME_PROMPT_PREVIEW_MODEL,
      HOME_PROMPT_PREVIEW_SORT
    );
    const sourceItems =
      filteredItems.length > 0
        ? filteredItems
        : filterPromptPoolItems(promptPoolItems, "", HOME_PROMPT_PREVIEW_MEDIA, "all", HOME_PROMPT_PREVIEW_SORT);

    return pickRandomPromptPreviewItems(sourceItems.filter((item) => item.assetUrl.trim()), HOME_PREVIEW_ITEMS);
  }, [promptPoolItems]);
  const hasPromptPoolPreview = promptPreviewItems.length > 0;

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
          </span>

          <span className="home-inspiration-preview" aria-hidden="true">
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
                  </span>
                ))
              ) : (
                <span className="home-inspiration-empty">{t("poolEmptyHint")}</span>
              )}
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

function pickRandomPromptPreviewItems(items: PromptPoolItem[], count: number): PromptPoolItem[] {
  if (items.length <= count) {
    return items;
  }

  const selectedIndexes = new Set<number>();
  while (selectedIndexes.size < count) {
    selectedIndexes.add(Math.floor(Math.random() * items.length));
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .map((index) => items[index]);
}
