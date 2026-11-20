"use client";

import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { joinWaitlistAction } from "@/app/waitlist/actions";
import { CopyReferral } from "@/components/copy-referral";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  draftForAttempt,
  referralShareMessage,
  type WaitlistActionResult,
  type WaitlistDraft,
} from "@/lib/waitlist";

function fieldError(
  state: WaitlistActionResult | null,
  field: "name" | "email" | "message" | "referral",
) {
  if (!state || state.ok || state.error !== "invalid") return undefined;
  return state.fieldErrors?.[field];
}

export function WaitlistForm() {
  const [attempt, setAttempt] = useState(0);

  return (
    <WaitlistAttempt
      key={attempt}
      ignoreUrlReferral={attempt > 0}
      onAnotherEmail={() => setAttempt((current) => current + 1)}
    />
  );
}

function WaitlistAttempt({
  ignoreUrlReferral,
  onAnotherEmail,
}: {
  ignoreUrlReferral: boolean;
  onAnotherEmail: () => void;
}) {
  const searchParams = useSearchParams();
  const urlReferral = searchParams.get("ref") ?? "";
  const seeded = draftForAttempt(urlReferral, ignoreUrlReferral ? 1 : 0);
  const referralFromUrl = seeded.referral;
  const [draft, setDraft] = useState<WaitlistDraft>(seeded);
  const [canEditReferral, setCanEditReferral] = useState(referralFromUrl.length === 0);
  const [trackedReferral, setTrackedReferral] = useState(referralFromUrl);
  if (referralFromUrl !== trackedReferral) {
    setTrackedReferral(referralFromUrl);
    setDraft((current) => ({ ...current, referral: referralFromUrl }));
    setCanEditReferral(referralFromUrl.length === 0);
  }
  const [state, action, pending] = useActionState(joinWaitlistAction, null);
  const confirmed = state?.ok && state.shareUrl ? state : null;

  useEffect(() => {
    const focusId = confirmed ? "waitlist-thanks-heading" : ignoreUrlReferral ? "waitlist-name" : "";
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
  }, [confirmed, ignoreUrlReferral]);

  if (confirmed) {
    return (
      <div className="waitlist-thanks">
        <h3 id="waitlist-thanks-heading" tabIndex={-1}>
          {confirmed.alreadyJoined
            ? "You are already on the waitlist."
            : "You are on the waitlist."}
        </h3>
        <CopyReferral message={referralShareMessage(confirmed.shareUrl)} />
        <Button
          type="button"
          onClick={onAnotherEmail}
        >
          Sign up another email
        </Button>
      </div>
    );
  }

  const nameError = fieldError(state, "name");
  const emailError = fieldError(state, "email");
  const messageError = fieldError(state, "message");
  const referralError = fieldError(state, "referral");
  if (referralError && !canEditReferral) setCanEditReferral(true);
  const referralLocked = !canEditReferral;
  const unavailable = state !== null && !state.ok && state.error === "unavailable";

  return (
    <form action={action} className="waitlist-form" noValidate>
      <div className="waitlist-field">
        <label htmlFor="waitlist-name">Name</label>
        <Input
          id="waitlist-name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "waitlist-name-error" : undefined}
        />
        {nameError ? (
          <p id="waitlist-name-error" className="waitlist-error">
            {nameError}
          </p>
        ) : null}
      </div>
      <div className="waitlist-field">
        <label htmlFor="waitlist-email">Email</label>
        <Input
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={draft.email}
          onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "waitlist-email-error" : undefined}
        />
        {emailError ? (
          <p id="waitlist-email-error" className="waitlist-error">
            {emailError}
          </p>
        ) : null}
      </div>
      <div className="waitlist-field">
        <label htmlFor="waitlist-message">Message (optional)</label>
        <Textarea
          id="waitlist-message"
          name="message"
          rows={4}
          maxLength={1000}
          value={draft.message}
          onChange={(event) => setDraft({ ...draft, message: event.target.value })}
          aria-invalid={messageError ? true : undefined}
          aria-describedby={messageError ? "waitlist-message-error" : undefined}
        />
        {messageError ? (
          <p id="waitlist-message-error" className="waitlist-error">
            {messageError}
          </p>
        ) : null}
      </div>
      <div className="waitlist-field">
        <label htmlFor="waitlist-referral">Referral code (optional)</label>
        <Input
          id="waitlist-referral"
          name="referral"
          value={draft.referral}
          onChange={(event) => setDraft({ ...draft, referral: event.target.value })}
          readOnly={referralLocked}
          maxLength={128}
          aria-invalid={referralError ? true : undefined}
          aria-describedby={
            referralError || referralLocked ? "waitlist-referral-note" : undefined
          }
          data-referral-retry={canEditReferral && referralFromUrl ? "ready" : undefined}
        />
        {referralLocked ? (
          <p id="waitlist-referral-note">This code came from the link you opened.</p>
        ) : null}
        {referralError ? (
          <p id="waitlist-referral-note" className="waitlist-error" role="alert">
            {referralError}
          </p>
        ) : null}
      </div>
      {unavailable ? (
        <p className="waitlist-error" role="alert">
          We could not save your signup. Try again once the waitlist database is
          available.
        </p>
      ) : null}
      <Button
        type="submit"
        className="waitlist-submit"
        disabled={pending}
      >
        {pending ? "Saving" : "Join the waitlist"}
      </Button>
    </form>
  );
}
