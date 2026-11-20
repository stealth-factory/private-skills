import "server-only";

import { Resend } from "resend";

import { type WaitlistMail } from "@/lib/waitlist-mail";

const RETRYABLE_ERRORS = new Set([
  "rate_limit_exceeded",
  "internal_server_error",
  "application_error",
  "concurrent_idempotent_requests",
]);

export async function sendWaitlistMail(mail: WaitlistMail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("waitlist mail skipped: not configured");
    return;
  }

  const resend = new Resend(apiKey);
  let outcome = "unknown";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await resend.emails.send(
        {
          from: mail.from,
          to: [mail.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        },
        { idempotencyKey: mail.idempotencyKey },
      );
      if (!result.error) return;
      outcome = RETRYABLE_ERRORS.has(result.error.name) ? result.error.name : "rejected";
      if (!RETRYABLE_ERRORS.has(result.error.name)) break;
    } catch {
      outcome = "network";
    }
  }
  console.error(failureLabel(mail), outcome);
}

function failureLabel(mail: WaitlistMail): string {
  if (mail.idempotencyKey.startsWith("waitlist-signup-notice/")) return "waitlist notice failed";
  if (mail.idempotencyKey.startsWith("waitlist-signup-thanks/")) return "waitlist thanks failed";
  return "waitlist mail failed";
}
