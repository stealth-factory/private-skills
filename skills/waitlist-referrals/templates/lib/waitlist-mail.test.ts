import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WAITLIST_FROM,
  WAITLIST_NOTICE_SUBJECT,
  WAITLIST_NOTICE_TO,
  WAITLIST_SHARE_ORIGIN,
  WAITLIST_THANKS_SUBJECT,
  notifyAfterJoin,
  type WaitlistMail,
} from "./waitlist-mail.ts";
import type { JoinSuccess } from "./waitlist.ts";

const signupId = "11111111-1111-4111-8111-111111111111";
const longToken = "SpxeEvbcoKHy-JI0qt0XCg";
const shortCode = "AdaCode1";
const referrerCode = "OldCode1";

function fresh(overrides: Partial<JoinSuccess> = {}): JoinSuccess {
  return {
    ok: true,
    token: longToken,
    shortCode,
    alreadyJoined: false,
    referralCount: 0,
    signupId,
    ...overrides,
  };
}

const details = {
  name: 'Ada <script> & "Lovelace"',
  email: "ada@example.com",
  message: "Hello\n<script>",
  referrerCode,
};

async function capture(joined = fresh(), input = details) {
  const sent: WaitlistMail[] = [];
  await notifyAfterJoin(joined, input, async (mail) => {
    sent.push(mail);
  });
  return sent;
}

describe("waitlist mail", () => {
  it("sends the notice and the thank-you for a new signup", async () => {
    const sent = await capture();
    assert.equal(sent.length, 2);
    const notice = sent.find((mail) => mail.to === WAITLIST_NOTICE_TO);
    const thanks = sent.find((mail) => mail.to === "ada@example.com");
    assert.ok(notice);
    assert.ok(thanks);
    assert.equal(notice.from, WAITLIST_FROM);
    assert.equal(thanks.from, WAITLIST_FROM);
    assert.equal(notice.subject, WAITLIST_NOTICE_SUBJECT);
    assert.equal(thanks.subject, WAITLIST_THANKS_SUBJECT);
    assert.equal(notice.idempotencyKey, `waitlist-signup-notice/${signupId}`);
    assert.equal(thanks.idempotencyKey, `waitlist-signup-thanks/${signupId}`);
    assert.notEqual(notice.idempotencyKey, thanks.idempotencyKey);

    const shareUrl = `${WAITLIST_SHARE_ORIGIN}/?ref=${shortCode}`;
    assert.equal(thanks.text.includes(shareUrl), true);
    assert.equal(thanks.html.includes(`href="${shareUrl}"`), true);
    assert.equal(notice.text.includes(`Share code: ${shortCode}`), true);
    assert.equal(notice.text.includes(`Referred by: ${referrerCode}`), true);
    assert.equal(notice.text.includes("Name: Ada <script>"), true);
    assert.equal(notice.text.includes("Email: ada@example.com"), true);
    assert.equal(notice.text.includes("Message: Hello\n<script>"), true);
    assert.equal(thanks.text.includes(longToken), false);
    assert.equal(thanks.text.includes(referrerCode), false);
    assert.equal(thanks.html.includes(longToken), false);
    assert.equal(notice.html.includes("<script>"), false);
    assert.equal(notice.html.includes("&lt;script&gt;"), true);
    assert.equal(notice.html.includes("Hello<br>&lt;script&gt;"), true);
    assert.equal(notice.html.includes("&amp;"), true);
    for (const mail of sent) {
      assert.equal(/[\r\n]/.test(mail.subject), false);
      assert.equal(/[\r\n]/.test(mail.from), false);
      assert.equal(/[\r\n]/.test(mail.to), false);
      assert.equal(mail.subject.includes("ada@example.com"), false);
      assert.equal(mail.subject.includes("Ada"), false);
    }
  });

  it("keeps a legacy referrer off the thank-you and out of the share link", async () => {
    const sent = await capture(fresh(), { ...details, referrerCode: longToken });
    const notice = sent.find((mail) => mail.to === WAITLIST_NOTICE_TO);
    const thanks = sent.find((mail) => mail.to === "ada@example.com");
    assert.ok(notice);
    assert.ok(thanks);
    assert.equal(notice.text.includes(`Referred by: ${longToken}`), true);
    assert.equal(notice.text.includes(`Share code: ${shortCode}`), true);
    assert.equal(thanks.text.includes(longToken), false);
    assert.equal(thanks.text.includes(`${WAITLIST_SHARE_ORIGIN}/?ref=${shortCode}`), true);
    assert.equal(thanks.text.startsWith("Thank you for joining the __PRODUCT__ waitlist."), true);
    assert.equal(thanks.text.includes("__REFERRAL_INVITE__"), false);
  });

  it("does not send when the signup already existed or was rejected", async () => {
    const sent: WaitlistMail[] = [];
    const send = async (mail: WaitlistMail) => {
      sent.push(mail);
    };
    await notifyAfterJoin(fresh({ alreadyJoined: true }), details, send);
    await notifyAfterJoin({ ok: false, error: "invalid" }, details, send);
    await notifyAfterJoin({ ok: false, error: "unavailable" }, details, send);
    assert.equal(sent.length, 0);
  });

  it("sends the other message when one send fails", async () => {
    const sent: string[] = [];
    await notifyAfterJoin(fresh(), details, async (mail) => {
      sent.push(mail.idempotencyKey);
      if (mail.idempotencyKey.startsWith("waitlist-signup-notice/")) {
        throw new Error("notice mailbox rejected the message");
      }
    });
    assert.deepEqual(sent, [
      `waitlist-signup-notice/${signupId}`,
      `waitlist-signup-thanks/${signupId}`,
    ]);
  });

  it("still resolves when both sends fail", async () => {
    await notifyAfterJoin(fresh(), details, async () => {
      throw new Error("mail provider unavailable");
    });
  });

  it("does not put a newline address into a recipient header", async () => {
    const sent = await capture(fresh(), {
      ...details,
      email: "ada@example.com\nBcc: evil@example.com",
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, WAITLIST_NOTICE_TO);
    assert.equal(sent[0]?.text.includes("Email: unavailable"), true);
    assert.equal(sent[0]?.text.includes("Bcc:"), false);
  });

  it("omits a share link that is not an 8-character code", async () => {
    const sent = await capture(fresh({ shortCode: longToken }));
    const thanks = sent.find((mail) => mail.to === "ada@example.com");
    assert.ok(thanks);
    assert.equal(thanks.text.includes("http"), false);
    assert.equal(thanks.html.includes("href="), false);
    assert.equal(sent[0]?.text.includes("Share code: unavailable"), true);
    assert.equal(sent[0]?.text.includes(longToken), false);
  });
});
