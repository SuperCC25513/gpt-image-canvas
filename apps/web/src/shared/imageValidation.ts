import {
  IMAGE_SIZE_MULTIPLE,
  MAX_IMAGE_ASPECT_RATIO,
  MAX_IMAGE_DIMENSION,
  MAX_TOTAL_PIXELS,
  MIN_IMAGE_DIMENSION,
  MIN_TOTAL_PIXELS,
  validateImageSize,
  type ImageSizeValidationReason
} from "@gpt-image-canvas/shared";
import type { Locale, Translate } from "./i18n";

export function sizeValidationMessage(width: number, height: number, t: Translate, locale: Locale): string {
  const result = validateImageSize({ width, height });

  if (result.ok) {
    return "";
  }

  return imageSizeValidationMessage(result.reason, t, locale);
}

function imageSizeValidationMessage(reason: ImageSizeValidationReason | undefined, t: Translate, locale: Locale): string {
  const numberFormat = new Intl.NumberFormat(locale);

  switch (reason) {
    case "non_integer":
      return t("imageSizeNonInteger");
    case "too_small":
      return t("imageSizeTooSmall", { min: MIN_IMAGE_DIMENSION });
    case "too_large":
      return t("imageSizeTooLarge", { max: MAX_IMAGE_DIMENSION });
    case "not_multiple":
      return t("imageSizeNotMultiple", { multiple: IMAGE_SIZE_MULTIPLE });
    case "aspect_ratio":
      return t("imageSizeAspectRatio", { maxRatio: MAX_IMAGE_ASPECT_RATIO });
    case "total_pixels_too_small":
      return t("imageSizeTotalTooSmall", { minPixels: numberFormat.format(MIN_TOTAL_PIXELS) });
    case "total_pixels_too_large":
      return t("imageSizeTotalTooLarge", { maxPixels: numberFormat.format(MAX_TOTAL_PIXELS) });
    case "unsupported_preset":
      return t("imageSizeUnsupportedPreset");
    default:
      return t("imageSizeUnsupportedPreset");
  }
}
