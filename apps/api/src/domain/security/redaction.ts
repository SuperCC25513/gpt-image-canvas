const DEFAULT_MAX_REDACTED_TEXT_LENGTH = 1200;
const SECRET_ASSIGNMENT_KEYS =
  "(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|authorization|x-api-key|x-openai-api-key|signature|ossaccesskeyid|x-amz-signature|x-oss-signature)";

export function redactSensitiveText(
  value: string | undefined | null,
  options: { maxLength?: number } = {}
): string | undefined {
  const maxLength = options.maxLength ?? DEFAULT_MAX_REDACTED_TEXT_LENGTH;
  const sanitized = value
    ?.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .replace(new RegExp(`\\b(${SECRET_ASSIGNMENT_KEYS})(\\s*[:=]\\s*)(["']?)[^\\s"',;&]+`, "giu"), "$1$2$3[redacted]")
    .replace(new RegExp(`([?&])(${SECRET_ASSIGNMENT_KEYS})=([^&#\\s]+)`, "giu"), "$1$2=[redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/giu, "Basic [redacted]")
    .trim()
    .slice(0, maxLength);

  return sanitized || undefined;
}
