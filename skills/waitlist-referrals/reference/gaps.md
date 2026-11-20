# Known gaps, and how to close them

The templates were built for a small launch and include none of the
following. Each item says what can go wrong and the smallest fix that fits
the existing design.

## Email is not verified

**Risk.** Anyone can type someone else's address. That address gets the
thank-you email, and the signup counts toward a referrer.

**Fix.** Add `verified_at timestamptz` to `waitlist_signups`. Make the
thank-you email a confirmation link
(`/waitlist/confirm/<opaque referral_code>`), not a share link. Count only
referrals whose referred signup is verified:

```sql
select count(*) from waitlist_referrals r
join waitlist_signups s on s.id = r.referred_signup_id
where r.referrer_signup_id = $1 and s.verified_at is not null;
```

Keep the duplicate-email behaviour, but only show the share link once the
signup is verified, so nobody can retrieve another person's link by typing
their email.

## No rate limiting or bot protection

**Risk.** A script can submit the action in a loop. Each new email writes a
row and sends two emails, which costs Resend quota and the sender's
reputation.

**Fix.** On Vercel, add BotID or a Turnstile token check at the top of
`joinWaitlistAction`, before `validateWaitlistInput`. Add a per-IP limit (for
example Upstash Ratelimit, keyed on `x-forwarded-for`). On limit, return the
existing `{ ok: false, error: "unavailable" }`. Don't add a new error state
that the form doesn't render.

## Referral counts can be gamed

**Risk.** One person can create many addresses (`a+1@…`, `a+2@…`, throwaway
domains) and inflate their own count. The thanks page tells people that
access goes "first to people with more referrals", which gives them a reason
to try.

**Fix.** Verification (above) removes the cheapest version. For the rest,
normalise for matching only: strip `+tag`, and remove dots for Gmail. Store
that in a second unique column, and keep `email_normalized` as the address
emails go to. Review the top of the referral table by hand before granting
access. That is a judgement call, not a constraint.

## No unsubscribe or deletion

**Risk.** Privacy law (GDPR, the Australian Privacy Act) requires a way to
remove someone's data. Today that means a manual SQL delete. The foreign keys
are `ON DELETE no action`, so the referral rows have to be deleted first.

**Fix.** Add an opaque-token deletion link to the thank-you email. Delete the
`waitlist_referrals` rows on both sides, then the signup, in one CTE. Decide
whether a referrer keeps credit for a referred person who leaves. Today's
schema can't keep it, because the row has to go.

## Smaller things

- `findByEmail` compares the lowercase string exactly. `Ada@Example.com` and
  `ada@example.com` match, but Unicode or IDN variants don't.
- The notice email puts user text in the body, escaped. It never goes in a
  header, and the subject is constant. Keep it that way if you add fields.
- `alreadyJoined` reveals that an email is on the list. Verification above
  closes that too.
