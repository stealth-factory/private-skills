# Design: why the waitlist works the way it does

Read this before you change behaviour that a test pins. Each section names the
test that pins it, from `templates/lib/waitlist.test.ts` and
`templates/lib/waitlist-mail.test.ts`.

## The store boundary

`lib/waitlist.ts` never imports a database. `joinWaitlist(store, input,
nextToken, nextShortCode)` takes:

```ts
type WaitlistStore = {
  findByEmail(email: string): Promise<StoredSignup | null>;
  findByCode(code: string): Promise<StoredSignup | null>; // matches either code column
  saveSignup(input: { signup; referrerSignupId: string | null }): Promise<StoredSignup>;
  countReferrals(referrerSignupId: string): Promise<number>;
};
```

`saveSignup` must throw `DuplicateEmailError` or `DuplicateReferralCodeError`
on the matching unique violation. That contract is the whole interface. The
tests run against an in-memory store with the same rules, so the logic is
tested without Postgres. To move to another database, write a new store and
keep `waitlist.ts` as it is.

`waitlist-db.ts` recognises a violation by Postgres code `23505` plus the
constraint name. The constraint name is matched against `error.constraint`
first, then against the message, because the Neon HTTP driver doesn't always
fill in `constraint`. **Renaming an index in `schema.ts` silently breaks this
mapping.** Change both together.

## The join algorithm

```text
validate → normalise (trim, lowercase email, empty message → null)
findByEmail(email)            hit → return it (alreadyJoined: true)
if referral code:
  findByCode(code)            miss → { invalid, fieldErrors.referral }
  referrer.email == email     → return referrer (alreadyJoined: true)
repeat up to 5 times:
  saveSignup(new token, new short code, referrerId)
    DuplicateReferralCodeError → draw new codes, retry
    DuplicateEmailError        → findByEmail again (lost a race) → return it as alreadyJoined
→ { ok, token, shortCode, alreadyJoined, referralCount, signupId }
```

Pinned by these tests: "does not add another referral when the same email is
submitted again", "rejects a self referral and keeps the count at zero",
"rejects an unknown code and saves nothing", "retries a colliding code and
still finds a legacy code" and "stops after repeated collisions without
replacing the saved code". **The lost-race branch (`DuplicateEmailError` →
find again) has no test.** If you change it, add one with a store that throws
on the first save.

**Why a duplicate is a success.** A person who signs up twice usually lost
their link. Telling them "already registered" and showing nothing helps no
one. Returning the same link and count does. It also doesn't reveal anything
new: the response is the same as a fresh signup, apart from the heading.

**Why self-referral returns early rather than erroring.** The person did
nothing wrong; they opened their own link. So it shows them their own signup.

## Codes

| | `referral_code` (token) | `short_referral_code` (share code) |
| --- | --- | --- |
| Shape | 16 random bytes, base64url, 22 characters | 8 characters from `[A-Za-z0-9]` |
| Entropy | 128 bits | 8 × log2(62) ≈ 47.6 bits |
| Accepted pattern | `^[A-Za-z0-9_-]{16,128}$` | `^[A-Za-z0-9]{8}$` |
| Used in | old links, the response `token` | every new share link and email |

`isReferralToken` accepts both shapes, and `findByCode` checks both columns,
so links already shared keep working. `shareCodeForSignup` prefers the short
code if it's valid and otherwise falls back to the token.

The short code is drawn by **rejection sampling**: bytes ≥ 248 are thrown
away, because `256 % 62 ≠ 0` and keeping them would bias the first 8
characters. If a batch of 16 bytes doesn't yield 8 characters it draws
another, up to 32 batches. The function takes a `fill` argument so the tests
can force rejections. 47.6 bits is not a secret: anyone can guess codes. It is
only meant to be unique and short enough to type. Nothing private sits behind
a code (see the thanks page below).

The database check `short_referral_code ~ '^[A-Za-z0-9]{8}$'` keeps a code
outside that alphabet from ever being stored.

## Share URL and message

- `originFromHeaders` reads `x-forwarded-host`, falling back to `host`, and
  `x-forwarded-proto`. It takes the first comma value, allows only `http` or
  `https` and a host matching `[a-z0-9.-]+(:port)?`, and otherwise returns `""`.
- `referralShareUrl(origin, code)` returns `""` for an invalid code and the
  relative `/?ref=` for an unusable origin. `withShareUrl` turns an empty URL
  into `{ ok: false, error: "unavailable" }` rather than showing an empty link.
- `referralShareMessage(link)` is `INVITE\n\nlink\n\nCLOSER`. The copy button
  copies the whole message, not just the URL, so the paste carries the pitch.
- `copyReferralMessage` reports `copied` or `failed` and never throws. The
  button announces the result in a polite live region, or an assertive one
  when the copy failed.

## Form behaviour (`waitlist-form.tsx`)

- `?ref=` prefills the referral field as **read-only**, with the note "This
  code came from the link you opened." It only becomes editable after the
  server rejects it, so the person can fix or clear it.
- After a successful signup, the form is replaced by the thanks state: a
  heading that receives focus, the copy button and "Sign up another email".
- "Sign up another email" bumps a `key`, which remounts the form **with an
  empty draft and without the URL code**. Otherwise a family member signing up
  on the same device would also be credited to whoever's link was opened.
  Pinned by "shows the saved link in place and starts the next signup empty".
- The input values are controlled `draft` state, so a server-side validation
  error doesn't wipe what the person typed.
- `noValidate`: the server owns validation, and its messages are the ones
  shown, through `aria-describedby`.

## The thanks page (`/waitlist/thanks/[token]`)

This is a public page for any valid code: the copy button and "N people have
joined with your link." A malformed or unknown code gives 404, and a database
outage gives an "unavailable" page. `?already=1` changes the heading.

**The count is public to anyone who has the code.** That's deliberate: the
code is designed to be shared, and the count is the only thing on the page. If
you add anything personal (name, position in the queue, email), put it behind
the opaque `referral_code` or a signed link, not the share code.

## Email (`waitlist-mail.ts`)

`notifyAfterJoin` only sends for `ok && !alreadyJoined`. It sends two emails:

| Email | To | Content |
| --- | --- | --- |
| Notice | `__NOTICE_EMAIL__` | name, email, message, share code, "Referred by" code |
| Thank-you | the person who joined | thanks plus `__SITE_ORIGIN__/?ref=<short code>` |

- The signup id must be a UUID, or no email is sent (this protects the
  idempotency key). The recipient must pass a header-safe check: no control
  characters, at most 254 characters. If it doesn't, only the notice is sent,
  and it shows the email as "unavailable".
- All user text is HTML-escaped, and line breaks in the message become `<br>`.
  Pinned by "sends the notice and the thank-you for a new signup", which
  also checks that no CR or LF reaches a header.
- Each send is in its own `try`, so one failure doesn't stop the other. The
  server action wraps the whole step again, so an email failure can never turn
  a saved signup into an error response.
- `sendWaitlistMail` retries once on Resend's retryable errors
  (`rate_limit_exceeded`, `internal_server_error`, `application_error`,
  `concurrent_idempotent_requests`). The idempotency key makes that retry, and
  any retried request, safe to repeat.
- Logs contain labels only (`waitlist thanks failed rejected`), never the
  address or the message.

## Validation limits

Name: 1–80 characters, no control characters. Email: `^[^\s@]+@[^\s@]+\.[^\s@]+$`,
at most 254 characters, compared in lowercase. Message: at most 1000
characters, optional. Referral: empty, or one of the two code shapes. The
inputs carry the same `maxLength` values, so the browser and the server agree.
