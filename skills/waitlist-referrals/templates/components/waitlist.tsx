import { Suspense } from "react";

import { WaitlistForm } from "@/components/waitlist-form";

// WaitlistForm reads ?ref= with useSearchParams, so it must sit inside a
// Suspense boundary or the whole page opts out of static rendering.
export function Waitlist() {
  return (
    <section className="waitlist" id="waitlist" tabIndex={-1} aria-labelledby="waitlist-heading">
      <h2 id="waitlist-heading">Waitlist</h2>
      <p>__WAITLIST_HOOK__</p>
      <Suspense fallback={<p>Loading the form.</p>}>
        <WaitlistForm />
      </Suspense>
    </section>
  );
}
