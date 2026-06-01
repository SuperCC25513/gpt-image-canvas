import { isIP } from "node:net";

export type OutboundUrlPurpose = "provider_base_url" | "provider_image_url";

export interface OutboundUrlValidationOptions {
  allowDataUrl?: boolean;
  purpose: OutboundUrlPurpose;
}

export class OutboundUrlError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OutboundUrlError";
  }
}

export function normalizeOutboundUrl(input: string, options: OutboundUrlValidationOptions): string {
  const raw = input.trim();
  if (!raw) {
    return "";
  }

  if (options.allowDataUrl && raw.startsWith("data:")) {
    return raw;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidOutboundUrl(options.purpose);
  }

  assertAllowedProtocol(url, options.purpose);
  assertNoUserInfo(url, options.purpose);
  assertAllowedHost(url.hostname, options.purpose);
  return url.toString().replace(/\/+$/u, "");
}

export function validateProviderImageUrl(input: string): URL {
  if (input.trim().startsWith("data:")) {
    return new URL(input);
  }

  const normalized = normalizeOutboundUrl(input, {
    allowDataUrl: false,
    purpose: "provider_image_url"
  });
  return new URL(normalized);
}

function assertAllowedProtocol(url: URL, purpose: OutboundUrlPurpose): void {
  if (url.protocol === "https:") {
    return;
  }

  if (url.protocol === "http:" && allowLocalProviderBaseUrl() && isLoopbackHost(url.hostname)) {
    return;
  }

  throw invalidOutboundUrl(purpose);
}

function assertNoUserInfo(url: URL, purpose: OutboundUrlPurpose): void {
  if (url.username || url.password) {
    throw invalidOutboundUrl(purpose);
  }
}

function assertAllowedHost(hostname: string, purpose: OutboundUrlPurpose): void {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw invalidOutboundUrl(purpose);
  }

  if (isLoopbackHost(normalized)) {
    if (allowLocalProviderBaseUrl()) {
      return;
    }
    throw invalidOutboundUrl(purpose);
  }

  if (normalized.endsWith(".local")) {
    throw invalidOutboundUrl(purpose);
  }

  const ipKind = isIP(normalized);
  if (ipKind === 4 && isBlockedIpv4(normalized)) {
    throw invalidOutboundUrl(purpose);
  }
  if (ipKind === 6 && isBlockedIpv6(normalized)) {
    throw invalidOutboundUrl(purpose);
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1" || normalized.startsWith("127.");
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/u, "");
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  const firstSegment = Number.parseInt(normalized.split(":")[0] ?? "", 16);
  if (Number.isInteger(firstSegment) && (firstSegment & 0xfe00) === 0xfc00) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return isIP(mappedIpv4) === 4 ? isBlockedIpv4(mappedIpv4) : true;
  }
  return false;
}

function allowLocalProviderBaseUrl(): boolean {
  return process.env.ALLOW_LOCAL_PROVIDER_BASE_URL === "true";
}

function invalidOutboundUrl(purpose: OutboundUrlPurpose): OutboundUrlError {
  const message =
    purpose === "provider_image_url"
      ? "Provider image URL is not allowed."
      : "Provider base URL must be an allowed HTTPS URL.";
  return new OutboundUrlError("invalid_provider_base_url", message);
}
