const NEW_REFERRAL_CODE_PATTERN = /^[A-Za-z0-9]{8}$/;
const LEGACY_REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const REFERRAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_ATTEMPTS = 5;
const ACCEPTANCE_LIMIT = Math.floor(256 / REFERRAL_ALPHABET.length) * REFERRAL_ALPHABET.length;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_LIMIT = 80;
const MESSAGE_LIMIT = 1000;

export class DuplicateEmailError extends Error {
  constructor() {
    super("This email is already on the waitlist.");
    this.name = "DuplicateEmailError";
  }
}

export class DuplicateReferralCodeError extends Error {
  constructor() {
    super("This referral code is already in use.");
    this.name = "DuplicateReferralCodeError";
  }
}

export type StoredSignup = {
  id: string;
  name: string;
  emailNormalized: string;
  message: string | null;
  referralCode: string;
  shortReferralCode: string | null;
};

export type WaitlistStore = {
  findByEmail(email: string): Promise<StoredSignup | null>;
  findByCode(code: string): Promise<StoredSignup | null>;
  saveSignup(input: {
    signup: Omit<StoredSignup, "id">;
    referrerSignupId: string | null;
  }): Promise<StoredSignup>;
  countReferrals(referrerSignupId: string): Promise<number>;
};

export type WaitlistField = "name" | "email" | "message" | "referral";

const referralError =
  "That referral code is not recognised. Correct it or clear it, then submit again.";

export type NormalizedSignup = {
  name: string;
  emailNormalized: string;
  message: string | null;
  referralCode: string | null;
};

export type JoinSuccess = {
  ok: true;
  token: string;
  shortCode: string | null;
  alreadyJoined: boolean;
  referralCount: number;
  signupId: string;
};

export type WaitlistDraft = {
  name: string;
  email: string;
  message: string;
  referral: string;
};

export type JoinFailure = {
  ok: false;
  error: "invalid" | "unavailable";
  fieldErrors?: Partial<Record<WaitlistField, string>>;
};

export type JoinResult = JoinSuccess | JoinFailure;

export type PublicReferral =
  | { status: "ok"; referralCount: number; shareCode: string }
  | { status: "missing" }
  | { status: "unavailable" };

export function isReferralToken(value: string): boolean {
  return NEW_REFERRAL_CODE_PATTERN.test(value) || LEGACY_REFERRAL_CODE_PATTERN.test(value);
}

export function createReferralToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function createShortReferralCode(
  fill: (bytes: Uint8Array) => void = fillRandomBytes,
): string {
  const chars: string[] = [];
  for (let batch = 0; batch < 32 && chars.length < REFERRAL_CODE_LENGTH; batch += 1) {
    const bytes = new Uint8Array(16);
    fill(bytes);
    for (const byte of bytes) {
      if (byte >= ACCEPTANCE_LIMIT) continue;
      chars.push(REFERRAL_ALPHABET.charAt(byte % REFERRAL_ALPHABET.length));
      if (chars.length === REFERRAL_CODE_LENGTH) break;
    }
  }
  if (chars.length !== REFERRAL_CODE_LENGTH) {
    throw new Error("Could not draw a referral code.");
  }
  return chars.join("");
}

function fillRandomBytes(bytes: Uint8Array) {
  crypto.getRandomValues(bytes);
}

export function referrerIdForSignup(
  referrer: StoredSignup | null,
  emailNormalized: string,
): string | null {
  if (!referrer) return null;
  if (referrer.emailNormalized === emailNormalized) return null;
  return referrer.id;
}

export function originFromHeaders(headerList: {
  get(name: string): string | null;
}): string {
  const host = (headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "")
    .split(",")[0]
    ?.trim();
  const proto = (headerList.get("x-forwarded-proto") ?? "http").split(",")[0]?.trim();
  if (proto !== "http" && proto !== "https") return "";
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return "";
  return `${proto}://${host}`;
}

export function referralShareUrl(origin: string, code: string): string {
  if (!isReferralToken(code)) return "";
  if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) return `/?ref=${code}`;
  return `${origin}/?ref=${code}`;
}

const REFERRAL_INVITE =
  "__REFERRAL_INVITE__";
const REFERRAL_CLOSER = "__REFERRAL_CLOSER__";

export function referralShareMessage(personalReferralLink: string): string {
  return `${REFERRAL_INVITE}\n\n${personalReferralLink}\n\n${REFERRAL_CLOSER}`;
}

export async function copyReferralMessage(
  message: string,
  writeText: (value: string) => Promise<void>,
): Promise<"copied" | "failed"> {
  try {
    await writeText(message);
    return "copied";
  } catch {
    return "failed";
  }
}

export function referralCountText(count: number): string {
  if (count === 1) return "1 person has joined with your link.";
  return `${count} people have joined with your link.`;
}

export function waitlistDraftFromUrl(referralFromUrl: string): WaitlistDraft {
  return { name: "", email: "", message: "", referral: referralFromUrl.trim() };
}

export function emptyWaitlistDraft(): WaitlistDraft {
  return { name: "", email: "", message: "", referral: "" };
}

export function draftForAttempt(referralFromUrl: string, attempt: number): WaitlistDraft {
  if (attempt > 0) return emptyWaitlistDraft();
  return waitlistDraftFromUrl(referralFromUrl);
}

export type WaitlistActionResult =
  | JoinFailure
  | (Omit<JoinSuccess, "signupId"> & { shareUrl: string });

export function shareCodeForSignup(signup: {
  referralCode: string;
  shortReferralCode: string | null;
}): string {
  if (signup.shortReferralCode && NEW_REFERRAL_CODE_PATTERN.test(signup.shortReferralCode)) {
    return signup.shortReferralCode;
  }
  return signup.referralCode;
}

export function withShareUrl(result: JoinSuccess, origin: string): WaitlistActionResult {
  const shareUrl = referralShareUrl(
    origin,
    shareCodeForSignup({
      referralCode: result.token,
      shortReferralCode: result.shortCode,
    }),
  );
  if (!shareUrl) return { ok: false, error: "unavailable" };
  return {
    ok: true,
    token: result.token,
    shortCode: result.shortCode,
    alreadyJoined: result.alreadyJoined,
    referralCount: result.referralCount,
    shareUrl,
  };
}

export function validateWaitlistInput(input: {
  name: string;
  email: string;
  message: string;
  referralToken: string;
}): { ok: true; value: NormalizedSignup } | JoinFailure {
  const fieldErrors: Partial<Record<WaitlistField, string>> = {};
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const message = input.message.trim();

  if (name.length === 0) {
    fieldErrors.name = "Enter your name.";
  } else if (name.length > NAME_LIMIT || /[\u0000-\u001F\u007F]/.test(name)) {
    fieldErrors.name = "Use a name of 80 characters or fewer.";
  }

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (message.length > MESSAGE_LIMIT) {
    fieldErrors.message = "Keep the message to 1000 characters or fewer.";
  }

  const referral = input.referralToken.trim();
  if (referral.length > 0 && !isReferralToken(referral)) {
    fieldErrors.referral = referralError;
  }

  if (fieldErrors.name || fieldErrors.email || fieldErrors.message || fieldErrors.referral) {
    return { ok: false, error: "invalid", fieldErrors };
  }

  return {
    ok: true,
    value: {
      name,
      emailNormalized: email,
      message: message.length > 0 ? message : null,
      referralCode: referral.length > 0 ? referral : null,
    },
  };
}

export async function joinWaitlist(
  store: WaitlistStore,
  input: NormalizedSignup,
  nextToken: () => string = createReferralToken,
  nextShortCode: () => string = createShortReferralCode,
): Promise<JoinResult> {
  const existing = await store.findByEmail(input.emailNormalized);
  if (existing) {
    return savedResult(store, existing, true);
  }

  let referrerSignupId: string | null = null;
  if (input.referralCode) {
    const referrer = await store.findByCode(input.referralCode);
    if (!referrer) {
      return { ok: false, error: "invalid", fieldErrors: { referral: referralError } };
    }
    if (referrer.emailNormalized === input.emailNormalized) {
      return savedResult(store, referrer, true);
    }
    referrerSignupId = referrer.id;
  }

  for (let attempt = 0; attempt < REFERRAL_CODE_ATTEMPTS; attempt += 1) {
    try {
      const created = await store.saveSignup({
        signup: {
          name: input.name,
          emailNormalized: input.emailNormalized,
          message: input.message,
          referralCode: nextToken(),
          shortReferralCode: nextShortCode(),
        },
        referrerSignupId,
      });
      return savedResult(store, created, false);
    } catch (error) {
      if (error instanceof DuplicateReferralCodeError) continue;
      if (!(error instanceof DuplicateEmailError)) throw error;
      const raced = await store.findByEmail(input.emailNormalized);
      if (!raced) throw error;
      return savedResult(store, raced, true);
    }
  }

  return { ok: false, error: "unavailable" };
}

async function savedResult(
  store: WaitlistStore,
  signup: StoredSignup,
  alreadyJoined: boolean,
): Promise<JoinSuccess> {
  return {
    ok: true,
    token: signup.referralCode,
    shortCode: signup.shortReferralCode,
    alreadyJoined,
    referralCount: await store.countReferrals(signup.id),
    signupId: signup.id,
  };
}

export async function loadPublicReferral(
  store: WaitlistStore,
  code: string,
): Promise<PublicReferral> {
  if (!isReferralToken(code)) return { status: "missing" };
  const signup = await store.findByCode(code);
  if (!signup) return { status: "missing" };
  const referralCount = await store.countReferrals(signup.id);
  return { status: "ok", referralCount, shareCode: shareCodeForSignup(signup) };
}
