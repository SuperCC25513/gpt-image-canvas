import {
  ArrowRight,
  CheckCircle2,
  Globe2,
  ImageIcon,
  Sparkles,
  Square
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GalleryImageItem } from "@gpt-image-canvas/shared";
import productPreviewUrl from "../../../../../docs/assets/app-preview.png";
import { assetPreviewUrl } from "../../shared/api/assets";
import { isGalleryResponse } from "../../shared/api/generation";
import { useI18n } from "../../shared/i18n";

const HOME_PUBLIC_PREVIEW_LIMIT = 8;
const HOME_PUBLIC_PREVIEW_WIDTH = 384;

interface HomePageProps {
  authError: string;
  onOpenCanvas: () => void;
  onOpenGenerate: () => void;
  onOpenPublicGallery: () => void;
}

export function HomePage({
  authError,
  onOpenCanvas,
  onOpenGenerate,
  onOpenPublicGallery
}: HomePageProps) {
  const { t } = useI18n();
  const [publicPreviewItems, setPublicPreviewItems] = useState<GalleryImageItem[]>([]);
  const [isPublicPreviewLoading, setIsPublicPreviewLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPublicPreview(): Promise<void> {
      setIsPublicPreviewLoading(true);

      try {
        const response = await fetch(`/api/gallery/public?limit=${HOME_PUBLIC_PREVIEW_LIMIT}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("public preview unavailable");
        }

        const body = (await response.json()) as unknown;
        if (!isGalleryResponse(body)) {
          throw new Error("public preview invalid");
        }

        if (!controller.signal.aborted) {
          setPublicPreviewItems(body.items.slice(0, HOME_PUBLIC_PREVIEW_LIMIT));
        }
      } catch {
        if (!controller.signal.aborted) {
          setPublicPreviewItems([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsPublicPreviewLoading(false);
        }
      }
    }

    void loadPublicPreview();

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
  const useCases = [
    t("homeUseCaseAvatar"),
    t("homeUseCaseProduct"),
    t("homeUseCaseCover"),
    t("homeUseCaseInterior"),
    t("homeUseCaseWallpaper")
  ];
  const fallbackPrompts = [
    t("homePromptIdeaPortrait"),
    t("homePromptIdeaPoster"),
    t("homePromptIdeaRoom")
  ];
  const hasPublicPreview = publicPreviewItems.length > 0;

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
          aria-label={t("homePreviewOpenPublicGallery")}
          className="home-inspiration-board"
          data-loading={isPublicPreviewLoading}
          data-testid="home-inspiration-board"
          type="button"
          onClick={onOpenPublicGallery}
        >
          <span className="home-inspiration-board__header">
            <span>
              <span className="home-section-kicker">{t("homePreviewKicker")}</span>
              <strong>{t("homePreviewTitle")}</strong>
            </span>
            <span className="home-inspiration-board__status">
              {hasPublicPreview ? t("homePreviewLive") : t("homePreviewFallback")}
            </span>
          </span>

          {hasPublicPreview ? (
            <span className="home-public-preview-grid" aria-hidden="true">
              {publicPreviewItems.map((item, index) => (
                <img
                  alt=""
                  className={`home-public-preview home-public-preview--${(index % 5) + 1}`}
                  key={item.outputId}
                  src={assetPreviewUrl(item.asset.id, HOME_PUBLIC_PREVIEW_WIDTH)}
                />
              ))}
            </span>
          ) : (
            <span className="home-fallback-preview" aria-hidden="true">
              <img alt="" src={productPreviewUrl} />
              <span className="home-fallback-prompts">
                {fallbackPrompts.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </span>
            </span>
          )}

          <span className="home-inspiration-board__cta">
            <ImageIcon className="size-4" aria-hidden="true" />
            {t("homePreviewOpen")}
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
