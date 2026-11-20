"use server";

import { headers } from "next/headers";

import { notifyAfterJoin } from "@/lib/waitlist-mail";
import { sendWaitlistMail } from "@/lib/waitlist-mail-send";
import { createNeonWaitlistStore, readDatabaseUrl } from "@/lib/waitlist-db";
import {
  joinWaitlist,
  originFromHeaders,
  validateWaitlistInput,
  withShareUrl,
  type WaitlistActionResult,
} from "@/lib/waitlist";

export async function joinWaitlistAction(
  _previous: WaitlistActionResult | null,
  formData: FormData,
): Promise<WaitlistActionResult> {
  const parsed = validateWaitlistInput({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    message: String(formData.get("message") ?? ""),
    referralToken: String(formData.get("referral") ?? ""),
  });
  if (!parsed.ok) return parsed;

  const databaseUrl = readDatabaseUrl();
  if (!databaseUrl) return { ok: false, error: "unavailable" };

  try {
    const joined = await joinWaitlist(createNeonWaitlistStore(databaseUrl), parsed.value);
    if (!joined.ok) return joined;
    try {
      await notifyAfterJoin(
        joined,
        {
          name: parsed.value.name,
          email: parsed.value.emailNormalized,
          message: parsed.value.message,
          referrerCode: parsed.value.referralCode,
        },
        sendWaitlistMail,
      );
    } catch {
      console.error("waitlist mail failed");
    }
    return withShareUrl(joined, originFromHeaders(await headers()));
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
