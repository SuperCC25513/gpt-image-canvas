import {
  MailgunEmailConfigError,
  MailgunEmailSendError,
  sendMailgunEmail
} from "../infrastructure/email/mailgun-email.js";

async function main(): Promise<void> {
  assertRequiredEnv(["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM", "MAILGUN_TO"]);

  const result = await sendMailgunEmail({
    to: process.env.MAILGUN_TO ?? "",
    subject: process.env.MAILGUN_SUBJECT?.trim() || "GPT Image Canvas Mailgun smoke",
    text:
      process.env.MAILGUN_TEXT?.trim() ||
      `Mailgun smoke check sent at ${new Date().toISOString()} from GPT Image Canvas.`,
    testMode: parseBoolean(process.env.MAILGUN_TEST_MODE)
  });

  console.log(`mailgun smoke passed: status=${result.status}${result.id ? ` id=${result.id}` : ""}`);
}

function assertRequiredEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new MailgunEmailConfigError(`${missing.join(", ")} required.`);
  }
}

function parseBoolean(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

main().catch((error: unknown) => {
  if (error instanceof MailgunEmailConfigError) {
    console.error(`mailgun smoke config failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof MailgunEmailSendError) {
    const suffix = error.status ? ` status=${error.status}` : "";
    console.error(`mailgun smoke send failed:${suffix} ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.error("mailgun smoke failed.");
  process.exitCode = 1;
});
