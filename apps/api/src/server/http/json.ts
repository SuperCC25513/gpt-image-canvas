import { errorResponse, type ErrorResponseBody, type ParseResult } from "./errors.js";

export const DEFAULT_JSON_BODY_MAX_BYTES = 1024 * 1024;
export const PROJECT_JSON_BODY_MAX_BYTES = 110 * 1024 * 1024;
export const IMAGE_EDIT_JSON_BODY_MAX_BYTES = 220 * 1024 * 1024;
export const AGENT_CONVERSATION_JSON_BODY_MAX_BYTES = 5 * 1024 * 1024;

export interface ReadJsonOptions {
  maxBytes?: number;
}

export async function readJson(request: Request, options: ReadJsonOptions = {}): Promise<ParseResult<unknown>> {
  const contentType = request.headers.get("content-type");
  if (contentType && !isJsonContentType(contentType)) {
    return {
      ok: false,
      error: errorResponse("unsupported_media_type", "请求 Content-Type 必须是 application/json。")
    };
  }

  const maxBytes = validMaxBytes(options.maxBytes) ?? DEFAULT_JSON_BODY_MAX_BYTES;
  const contentLength = parseContentLength(request.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > maxBytes) {
    return {
      ok: false,
      error: requestBodyTooLarge()
    };
  }

  let bodyText: string;
  try {
    const result = await readRequestTextWithLimit(request, maxBytes);
    if (!result.ok) {
      return result;
    }
    bodyText = result.value;
  } catch {
    return {
      ok: false,
      error: errorResponse("invalid_request_body", "请求体读取失败，请重试。")
    };
  }

  if (bodyText.trim().length === 0) {
    return {
      ok: false,
      error: errorResponse("empty_json", "请求体不能为空，必须是有效的 JSON。")
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(bodyText) as unknown
    };
  } catch {
    return {
      ok: false,
      error: errorResponse("invalid_json", "请求体必须是有效的 JSON。")
    };
  }
}

export function jsonErrorStatus(error: ErrorResponseBody): 400 | 413 | 415 {
  if (error.error.code === "request_body_too_large") {
    return 413;
  }
  if (error.error.code === "unsupported_media_type") {
    return 415;
  }
  return 400;
}

async function readRequestTextWithLimit(request: Request, maxBytes: number): Promise<ParseResult<string>> {
  if (!request.body) {
    return {
      ok: true,
      value: ""
    };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let bodyText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          error: requestBodyTooLarge()
        };
      }

      bodyText += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  bodyText += decoder.decode();
  return {
    ok: true,
    value: bodyText
  };
}

function requestBodyTooLarge(): ErrorResponseBody {
  return errorResponse("request_body_too_large", "请求体过大。");
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function parseContentLength(value: string | null): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function validMaxBytes(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
