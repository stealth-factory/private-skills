import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CopyReferral } from "@/components/copy-referral";
import { createNeonWaitlistStore, readDatabaseUrl } from "@/lib/waitlist-db";
import {
  isReferralToken,
  loadPublicReferral,
  originFromHeaders,
  referralCountText,
  referralShareMessage,
  referralShareUrl,
} from "@/lib/waitlist";

function WaitlistUnavailable() {
  return (
    <main className="thanks" id="main">
      <h1>Waitlist unavailable</h1>
      <p>We could not confirm this signup because the waitlist database is unavailable.</p>
      <Link href="/#waitlist">Back to the waitlist</Link>
    </main>
  );
}

export default function WaitlistThanks({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ already?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="thanks" id="main">
          <h1>Checking your signup</h1>
        </main>
      }
    >
      <Thanks params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Thanks({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ already?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  if (!isReferralToken(token)) notFound();

  const databaseUrl = readDatabaseUrl();
  if (!databaseUrl) return <WaitlistUnavailable />;

  let referral: Awaited<ReturnType<typeof loadPublicReferral>>;
  try {
    referral = await loadPublicReferral(createNeonWaitlistStore(databaseUrl), token);
  } catch {
    return <WaitlistUnavailable />;
  }

  switch (referral.status) {
    case "missing":
      notFound();
      break;
    case "unavailable":
      return <WaitlistUnavailable />;
    case "ok":
      break;
    default: {
      const unreachable: never = referral;
      return unreachable;
    }
  }

  const people = referralCountText(referral.referralCount);

  return (
    <main className="thanks" id="main">
      <p className="section-kicker">Waitlist</p>
      <h1>{query.already === "1" ? "You are already on the waitlist." : "You are on the waitlist."}</h1>
      <p>Share this link. Launch access is offered first to people with more referrals.</p>
      <CopyReferral
        message={referralShareMessage(
          referralShareUrl(originFromHeaders(await headers()), referral.shareCode),
        )}
      />
      <p>{people}</p>
      <Link href="/">Back to __PRODUCT__</Link>
    </main>
  );
}
