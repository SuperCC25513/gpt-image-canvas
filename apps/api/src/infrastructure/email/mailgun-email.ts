import "../runtime.js";

import FormData from "form-data";
import * as MailgunModule from "mailgun.js";
import { type MailgunMessageData, type MessagesSendResult } from "mailgun.js";

type MailgunConstructor = new (formData: typeof FormData) => {
  client(options: { username: string; key: string; url?: string; timeout?: number }): {
    messages: {
      create(domain: string, data: MailgunMessageData): Promise<MessagesSendResult>;
    };
  };
};

// mailgun.js v11 ships CommonJS runtime with ESM-looking declarations under NodeNext.
const Mailgun = MailgunModule.default as unknown as MailgunConstructor;

export interface MailgunEmailConfig {
  apiKey: string;
  domain: string;
  from: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface SendMailgunEmailInput {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  testMode?: boolean;
}

export interface SendMailgunEmailResult {
  id?: string;
  message?: string;
  status: number;
}

export class MailgunEmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailgunEmailConfigError";
  }
}

export class MailgunEmailSendError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "MailgunEmailSendError";
  }
}

export function readMailgunEmailConfigFromEnv(): MailgunEmailConfig {
  return {
    apiKey: requiredString(process.env.MAILGUN_API_KEY, "MAILGUN_API_KEY"),
    domain: requiredString(process.env.MAILGUN_DOMAIN, "MAILGUN_DOMAIN"),
    from: requiredString(process.env.MAILGUN_FROM, "MAILGUN_FROM"),
    baseUrl: optionalString(process.env.MAILGUN_BASE_URL),
    timeoutMs: optionalPositiveInteger(process.env.MAILGUN_TIMEOUT_MS, "MAILGUN_TIMEOUT_MS")
  };
}

export async function sendMailgunEmail(
  input: SendMailgunEmailInput,
  config: MailgunEmailConfig = readMailgunEmailConfigFromEnv()
): Promise<SendMailgunEmailResult> {
  const message = createMailgunMessageData(input, config.from);
  const mailgun = new Mailgun(FormData);
  const client = mailgun.client({
    username: "api",
    key: config.apiKey,
    url: config.baseUrl,
    timeout: config.timeoutMs
  });

  try {
    const result = await client.messages.create(config.domain, message);
    return normalizeSendResult(result);
  } catch (error) {
    throw mailgunSendError(error);
  }
}

export function createMailgunMessageData(input: SendMailgunEmailInput, from: string): MailgunMessageData {
  const to = normalizeRecipients(input.to);
  const subject = requiredString(input.subject, "subject");
  const text = optionalString(input.text);
  const html = optionalString(input.html);

  if (!text && !html) {
    throw new MailgunEmailConfigError("Email text or html content is required.");
  }

  const testMode = input.testMode ? { "o:testmode": "yes" as const } : {};

  if (text) {
    return {
      from,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
      ...testMode
    };
  }

  return {
    from,
    to,
    subject,
    html: html ?? "",
    ...testMode
  };
}

function normalizeRecipients(value: string | string[]): string[] {
  const recipients = Array.isArray(value) ? value : value.split(",");
  const normalized = recipients.map((recipient) => recipient.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new MailgunEmailConfigError("Email recipient is required.");
  }

  return normalized;
}

function normalizeSendResult(result: MessagesSendResult): SendMailgunEmailResult {
  return {
    id: optionalString(result.id),
    message: optionalString(result.message),
    status: result.status
  };
}

function mailgunSendError(error: unknown): MailgunEmailSendError {
  if (isMailgunApiError(error)) {
    const message = sanitizeErrorMessage(error.details || error.message || "Mailgun email request failed.");
    return new MailgunEmailSendError(message, error.status);
  }

  if (error instanceof Error) {
    return new MailgunEmailSendError(sanitizeErrorMessage(error.message || "Mailgun email request failed."));
  }

  return new MailgunEmailSendError("Mailgun email request failed.");
}

function isMailgunApiError(error: unknown): error is { details?: string; message?: string; status?: number } {
  return typeof error === "object" && error !== null && ("status" in error || "details" in error);
}

function sanitizeErrorMessage(value: string): string {
  const sanitized = value.replace(/[\r\n]/gu, " ").replace(/\s+/gu, " ").trim();
  return sanitized ? sanitized.slice(0, 240) : "Mailgun email request failed.";
}

function requiredString(value: unknown, label: string): string {
  const parsed = optionalString(value);
  if (!parsed) {
    throw new MailgunEmailConfigError(`${label} is required.`);
  }

  return parsed;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  const raw = optionalString(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MailgunEmailConfigError(`${label} must be a positive integer.`);
  }

  return parsed;
}
