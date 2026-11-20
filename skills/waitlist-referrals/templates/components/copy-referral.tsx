"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { copyReferralMessage } from "@/lib/waitlist";

export function CopyReferral({ message }: { message: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const feedback =
    status === "copied"
      ? "Message copied"
      : status === "failed"
        ? "Could not copy the referral message."
        : "";

  return (
    <div className="referral-share">
      <Button
        type="button"
        onClick={async () => {
          const next = await copyReferralMessage(message, (value) =>
            navigator.clipboard.writeText(value),
          );
          setStatus(next);
        }}
      >
        Copy referral message
      </Button>
      <p
        className={feedback ? undefined : "sr-only"}
        role={status === "failed" ? "alert" : "status"}
        aria-live={status === "failed" ? "assertive" : "polite"}
      >
        {feedback}
      </p>
    </div>
  );
}
