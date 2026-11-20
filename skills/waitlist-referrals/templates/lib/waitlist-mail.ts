export const WAITLIST_FROM = "__PRODUCT__ <__FROM_EMAIL__>";
export const WAITLIST_NOTICE_TO = "__NOTICE_EMAIL__";
export const WAITLIST_SHARE_ORIGIN = "__SITE_ORIGIN__";
export const WAITLIST_NOTICE_SUBJECT = "New __PRODUCT__ waitlist signup";
export const WAITLIST_THANKS_SUBJECT = "You are on the __PRODUCT__ waitlist";

const SHORT_CODE = /^[A-Za-z0-9]{8}$/;
const REFERRAL_TOKEN = /^(?:[A-Za-z0-9]{8}|[A-Za-z0-9_-]{16,128})$/;
const SIGNUP_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WaitlistMail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type WaitlistMailSender = (mail: WaitlistMail) => Promise<void>;

type JoinResult =
  | {
      ok: true;
      alreadyJoined: boolean;
      signupId: string;
      shortCode: string | null;
    }
  | { ok: false; error?: "invalid" | "unavailable" };

type SignupDetails = {
  name: string;
  email: string;
  message: string | null;
  referrerCode: string | null;
};

export async function notifyAfterJoin(
  joined: JoinResult,
  details: SignupDetails,
  send: WaitlistMailSender,
): Promise<void> {
  if (!joined.ok || joined.alreadyJoined) return;
  const mails = mailsForSignup({
    signupId: joined.signupId,
    shortCode: joined.shortCode,
    ...details,
  });
  await Promise.all(
    mails.map(async (mail) => {
      try {
        await send(mail);
      } catch {
        console.error(failureLabel(mail));
      }
    }),
  );
}

function mailsForSignup(signup: SignupDetails & {
  signupId: string;
  shortCode: string | null;
}): WaitlistMail[] {
  if (!SIGNUP_ID.test(signup.signupId)) {
    console.error("waitlist mail skipped: signup id is not usable");
    return [];
  }
  const shareUrl = shareUrlFor(signup.shortCode);
  if (!shareUrl) console.error("waitlist thanks omitted the share link");
  const mails = [noticeMail(signup, shareUrl)];
  const thanks = thanksMail(signup, shareUrl);
  if (thanks) mails.push(thanks);
  return mails;
}

function noticeMail(
  signup: SignupDetails & { signupId: string },
  shareUrl: string | null,
): WaitlistMail {
  const email = headerSafeEmail(signup.email) ? signup.email : "unavailable";
  const message = signup.message && signup.message.length > 0 ? signup.message : "none";
  const shareCode = shareUrl ? shareUrl.slice(shareUrl.lastIndexOf("=") + 1) : "unavailable";
  const referredBy = referrerText(signup.referrerCode);
  const lines = [
    "A new person joined the __PRODUCT__ waitlist.",
    "",
    `Name: ${signup.name}`,
    `Email: ${email}`,
    `Message: ${message}`,
    `Share code: ${shareCode}`,
    `Referred by: ${referredBy}`,
  ];
  return {
    from: WAITLIST_FROM,
    to: WAITLIST_NOTICE_TO,
    subject: WAITLIST_NOTICE_SUBJECT,
    text: lines.join("\n"),
    html: [
      "<p>A new person joined the __PRODUCT__ waitlist.</p>",
      "<p>",
      `Name: ${escapeHtml(signup.name)}<br>`,
      `Email: ${escapeHtml(email)}<br>`,
      `Message: ${escapeMultiline(message)}<br>`,
      `Share code: ${escapeHtml(shareCode)}<br>`,
      `Referred by: ${escapeHtml(referredBy)}`,
      "</p>",
    ].join(""),
    idempotencyKey: `waitlist-signup-notice/${signup.signupId}`,
  };
}

function thanksMail(
  signup: SignupDetails & { signupId: string },
  shareUrl: string | null,
): WaitlistMail | null {
  const email = headerSafeEmail(signup.email);
  if (!email) return null;
  const text = shareUrl
    ? `Thank you for joining the __PRODUCT__ waitlist.\n\nShare this link so a friend can join:\n${shareUrl}`
    : "Thank you for joining the __PRODUCT__ waitlist.";
  const html = shareUrl
    ? `<p>Thank you for joining the __PRODUCT__ waitlist.</p><p>Share this link so a friend can join:<br><a href="${shareUrl}">${escapeHtml(shareUrl)}</a></p>`
    : "<p>Thank you for joining the __PRODUCT__ waitlist.</p>";
  return {
    from: WAITLIST_FROM,
    to: email,
    subject: WAITLIST_THANKS_SUBJECT,
    text,
    html,
    idempotencyKey: `waitlist-signup-thanks/${signup.signupId}`,
  };
}

function shareUrlFor(shortCode: string | null): string | null {
  if (!shortCode || !SHORT_CODE.test(shortCode)) return null;
  return `${WAITLIST_SHARE_ORIGIN}/?ref=${shortCode}`;
}

function referrerText(code: string | null): string {
  if (!code || !REFERRAL_TOKEN.test(code)) return "none";
  return code;
}

function headerSafeEmail(email: string): string | null {
  if (!SAFE_EMAIL.test(email) || email.length > 254) return null;
  if (/[\u0000-\u001F\u007F]/.test(email)) return null;
  return email;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMultiline(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function failureLabel(mail: WaitlistMail): string {
  if (mail.idempotencyKey.startsWith("waitlist-signup-notice/")) return "waitlist notice failed";
  if (mail.idempotencyKey.startsWith("waitlist-signup-thanks/")) return "waitlist thanks failed";
  return "waitlist mail failed";
}
