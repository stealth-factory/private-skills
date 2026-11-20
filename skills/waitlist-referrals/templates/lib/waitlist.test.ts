import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DuplicateEmailError,
  DuplicateReferralCodeError,
  createReferralToken,
  createShortReferralCode,
  draftForAttempt,
  emptyWaitlistDraft,
  isReferralToken,
  joinWaitlist,
  loadPublicReferral,
  originFromHeaders,
  copyReferralMessage,
  referralShareMessage,
  referralShareUrl,
  shareCodeForSignup,
  referrerIdForSignup,
  validateWaitlistInput,
  withShareUrl,
  type JoinResult,
  type StoredSignup,
  type WaitlistStore,
} from "./waitlist.ts";

type ReferralRow = { referrerSignupId: string; referredSignupId: string };

function joinedOrThrow(result: JoinResult) {
  if (!result.ok) throw new Error("signup failed");
  return result;
}

function memoryStore(): WaitlistStore & {
  signups: StoredSignup[];
  referrals: ReferralRow[];
} {
  const signups: StoredSignup[] = [];
  const referrals: ReferralRow[] = [];
  return {
    signups,
    referrals,
    async findByEmail(email) {
      return signups.find((row) => row.emailNormalized === email) ?? null;
    },
    async findByCode(code) {
      return (
        signups.find(
          (row) => row.referralCode === code || row.shortReferralCode === code,
        ) ?? null
      );
    },
    async saveSignup({ signup, referrerSignupId }) {
      if (signups.some((row) => row.emailNormalized === signup.emailNormalized)) {
        throw new DuplicateEmailError();
      }
      if (signups.some((row) => row.referralCode === signup.referralCode)) {
        throw new DuplicateReferralCodeError();
      }
      if (
        signup.shortReferralCode &&
        signups.some((row) => row.shortReferralCode === signup.shortReferralCode)
      ) {
        throw new DuplicateReferralCodeError();
      }
      const stored = { ...signup, id: `id-${signups.length + 1}` };
      signups.push(stored);
      if (
        referrerSignupId &&
        referrerSignupId !== stored.id &&
        !referrals.some((row) => row.referredSignupId === stored.id)
      ) {
        referrals.push({ referrerSignupId, referredSignupId: stored.id });
      }
      return stored;
    },
    async countReferrals(referrerSignupId) {
      return referrals.filter((row) => row.referrerSignupId === referrerSignupId).length;
    },
  };
}

const valid = {
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  message: "A short note",
  referralToken: "",
};

describe("waitlist validation", () => {
  it("normalises email and keeps an optional message", () => {
    const result = validateWaitlistInput(valid);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.emailNormalized, "ada@example.com");
    assert.equal(result.value.message, "A short note");
    assert.equal(result.value.referralCode, null);
  });

  it("rejects a referral code that contains an email", () => {
    const result = validateWaitlistInput({
      ...valid,
      referralToken: "ada@example.com",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.fieldErrors?.referral ?? "", /not recognised/);
  });
});

describe("referral links", () => {
  it("attributes a new signup once and counts it for the referrer", async () => {
    const store = memoryStore();
    const owner = joinedOrThrow(
      await joinWaitlist(
        store,
        (validateWaitlistInput(valid) as { ok: true; value: never }).value,
        () => "token-owner-aaaaaa",
      ),
    );
    const referred = validateWaitlistInput({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: "",
      referralToken: owner.token,
    });
    assert.equal(referred.ok, true);
    if (!referred.ok) return;
    await joinWaitlist(store, referred.value, () => "token-grace-aaaaaa");

    assert.equal(store.referrals.length, 1);
    assert.deepEqual(store.referrals[0], {
      referrerSignupId: "id-1",
      referredSignupId: "id-2",
    });
    const ownerView = await loadPublicReferral(store, owner.token);
    assert.equal(ownerView.status, "ok");
    if (ownerView.status !== "ok") return;
    assert.equal(ownerView.referralCount, 1);
  });

  it("does not add another referral when the same email is submitted again", async () => {
    const store = memoryStore();
    const owner = joinedOrThrow(
      await joinWaitlist(
        store,
        (validateWaitlistInput(valid) as { ok: true; value: never }).value,
        () => "token-owner-aaaaaa",
      ),
    );
    const referred = validateWaitlistInput({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: "",
      referralToken: owner.token,
    });
    assert.equal(referred.ok, true);
    if (!referred.ok) return;
    await joinWaitlist(store, referred.value, () => "token-grace-aaaaaa");
    const again = validateWaitlistInput({
      name: "Grace Hopper",
      email: "GRACE@example.com",
      message: "Trying again",
      referralToken: owner.token,
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    const duplicate = joinedOrThrow(
      await joinWaitlist(store, again.value, () => "token-should-not-save"),
    );

    assert.equal(duplicate.alreadyJoined, true);
    assert.equal(duplicate.token, "token-grace-aaaaaa");
    assert.equal(store.signups.length, 2);
    assert.equal(store.referrals.length, 1);
    const ownerView = await loadPublicReferral(store, owner.token);
    assert.equal(ownerView.status, "ok");
    if (ownerView.status !== "ok") return;
    assert.equal(ownerView.referralCount, 1);
  });

  it("rejects an unknown code and saves nothing", async () => {
    const store = memoryStore();
    const parsed = validateWaitlistInput({
      ...valid,
      referralToken: "missing-token-aaaa",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = await joinWaitlist(store, parsed.value, () => "token-saved-aaaaaa");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.fieldErrors?.referral ?? "", /not recognised/);
    assert.equal(store.signups.length, 0);
    assert.equal(store.referrals.length, 0);
  });

  it("keeps the entered signup on a cleared retry and does not count twice", async () => {
    const store = memoryStore();
    const rejected = validateWaitlistInput({
      ...valid,
      referralToken: "missing-token-aaaa",
    });
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    const first = await joinWaitlist(store, rejected.value, () => "token-should-not-save");
    assert.equal(first.ok, false);

    const cleared = validateWaitlistInput({ ...valid, referralToken: "" });
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;
    const saved = await joinWaitlist(store, cleared.value, () => "token-saved-aaaaaa");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.alreadyJoined, false);
    assert.equal(store.signups.length, 1);
    assert.equal(store.referrals.length, 0);

    const repeat = await joinWaitlist(store, cleared.value, () => "token-again-aaaaaa");
    assert.equal(repeat.ok, true);
    if (!repeat.ok) return;
    assert.equal(repeat.alreadyJoined, true);
    assert.equal(repeat.token, "token-saved-aaaaaa");
    assert.equal(store.signups.length, 1);
    assert.equal(store.referrals.length, 0);
  });

  it("rejects a self referral and keeps the count at zero", async () => {
    const store = memoryStore();
    const owner = joinedOrThrow(
      await joinWaitlist(
        store,
        (validateWaitlistInput(valid) as { ok: true; value: never }).value,
        () => "token-owner-aaaaaa",
      ),
    );
    const parsed = validateWaitlistInput({
      ...valid,
      referralToken: owner.token,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = joinedOrThrow(await joinWaitlist(store, parsed.value, () => "token-new-aaaaaaaa"));
    assert.equal(result.alreadyJoined, true);
    assert.equal(result.token, owner.token);
    assert.equal(store.referrals.length, 0);
    assert.equal(referrerIdForSignup(store.signups[0] ?? null, "ada@example.com"), null);
    const ownerView = await loadPublicReferral(store, owner.token);
    assert.equal(ownerView.status, "ok");
    if (ownerView.status !== "ok") return;
    assert.equal(ownerView.referralCount, 0);
  });

  it("hides codes that were never saved and never returns an email", async () => {
    const store = memoryStore();
    assert.deepEqual(await loadPublicReferral(store, "missing-token-aaaa"), {
      status: "missing",
    });
    const view = await loadPublicReferral(store, "ada@example.com");
    assert.deepEqual(view, { status: "missing" });
    assert.equal(JSON.stringify(view).includes("@"), false);
  });

  it("builds a shareable URL that contains only the opaque code", () => {
    const token = createReferralToken();
    assert.equal(token.length, 22);
    assert.match(token, /^[A-Za-z0-9_-]{22}$/);
    const shortCode = createShortReferralCode();
    assert.equal(shortCode.length, 8);
    assert.match(shortCode, /^[A-Za-z0-9]{8}$/);
    assert.equal(isReferralToken(token), true);
    assert.equal(isReferralToken(shortCode), true);
    const origin = originFromHeaders({
      get(name: string) {
        if (name === "host") return "app.example:4000";
        if (name === "x-forwarded-proto") return "https";
        return null;
      },
    });
    const url = referralShareUrl(origin, shortCode);
    assert.equal(url, `https://app.example:4000/?ref=${shortCode}`);
    assert.equal(url.includes("@"), false);
  });

  it("shows the saved link in place and starts the next signup empty", async () => {
    const store = memoryStore();
    const parsed = validateWaitlistInput({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "A note",
      referralToken: "",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const first = await joinWaitlist(
      store,
      parsed.value,
      () => "token-ada-aaaaaaaa",
      () => "AdaCode1",
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.token, "token-ada-aaaaaaaa");
    assert.equal(first.shortCode, "AdaCode1");
    assert.equal(first.referralCount, 0);

    const shown = withShareUrl(first, "https://app.example:4000");
    assert.equal(shown.ok, true);
    if (!shown.ok) return;
    assert.equal(shown.shareUrl, "https://app.example:4000/?ref=AdaCode1");
    const copied = referralShareMessage(shown.shareUrl);
    assert.equal(
      copied,
      "__REFERRAL_INVITE__\n\nhttps://app.example:4000/?ref=AdaCode1\n\n__REFERRAL_CLOSER__",
    );
    assert.equal(copied.includes("ada@example.com"), false);
    assert.equal(copied.includes("A note"), false);
    assert.equal(copied.includes("token-ada-aaaaaaaa"), false);
    const written: string[] = [];
    assert.equal(
      await copyReferralMessage(copied, async (value) => {
        written.push(value);
      }),
      "copied",
    );
    assert.deepEqual(written, [copied]);
    assert.equal(
      await copyReferralMessage(copied, async () => {
        throw new Error("clipboard blocked");
      }),
      "failed",
    );

    const openedWithCode = draftForAttempt("AdaCode1", 0);
    assert.equal(openedWithCode.referral, "AdaCode1");
    const reset = draftForAttempt(first.token, 1);
    assert.deepEqual(reset, emptyWaitlistDraft());
    assert.equal(reset.name, "");
    assert.equal(reset.email, "");
    assert.equal(reset.message, "");
    assert.equal(reset.referral, "");

    const next = validateWaitlistInput({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: reset.message,
      referralToken: reset.referral,
    });
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.value.referralCode, null);
    const second = await joinWaitlist(store, next.value, () => "token-grace-aaaaaa");
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyJoined, false);
    assert.equal(second.token, "token-grace-aaaaaa");
    assert.equal(store.signups.length, 2);
    assert.equal(store.referrals.length, 0);
    const kept = await loadPublicReferral(store, first.token);
    assert.equal(kept.status, "ok");
    if (kept.status !== "ok") return;
    assert.equal(kept.referralCount, 0);
    assert.equal(kept.shareCode, "AdaCode1");
    assert.equal(store.signups[0]?.referralCode, "token-ada-aaaaaaaa");
  });
});

describe("referral codes", () => {
  it("leaves a long token in place until a short code exists", () => {
    const legacy = "SpxeEvbcoKHy-JI0qt0XCg";
    assert.equal(
      shareCodeForSignup({ referralCode: legacy, shortReferralCode: null }),
      legacy,
    );
    assert.equal(
      shareCodeForSignup({ referralCode: legacy, shortReferralCode: "AdaCode1" }),
      "AdaCode1",
    );
  });

  it("draws 8 alphanumeric characters and skips biasing bytes", () => {
    const batches = [
      Uint8Array.from([255, 248, 0, 25, 26, 51, 52, 61, 62, 10]),
    ];
    let batch = 0;
    const code = createShortReferralCode((bytes) => {
      bytes.set(batches[batch] ?? new Uint8Array(bytes.length));
      batch += 1;
    });
    assert.equal(code, "AZaz09AK");
    assert.equal(code.length, 8);
    assert.equal(isReferralToken(code), true);
    assert.equal(isReferralToken("ABCD-EFG"), false);
  });

  it("asks for more bytes when a batch is rejected", () => {
    const batches = [
      Uint8Array.from([255, 249, 250, 251, 252, 253, 254, 255]),
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
    ];
    let batch = 0;
    const code = createShortReferralCode((bytes) => {
      const source = batches[batch] ?? new Uint8Array();
      bytes.fill(255);
      bytes.set(source.subarray(0, bytes.length));
      batch += 1;
    });
    assert.equal(code, "ABCDEFGH");
    assert.equal(batch, 2);
  });

  it("retries a colliding code and still finds a legacy code", async () => {
    const store = memoryStore();
    const legacy = "SpxeEvbcoKHy-JI0qt0XCg";
    assert.equal(legacy.length, 22);
    assert.equal(isReferralToken(legacy), true);
    const owner = validateWaitlistInput({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "",
      referralToken: "",
    });
    assert.equal(owner.ok, true);
    if (!owner.ok) return;
    const saved = await joinWaitlist(store, owner.value, () => legacy, () => "OldCode1");
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.token, legacy);
    assert.equal(saved.shortCode, "OldCode1");

    const codes = ["OldCode1", "NewCode1"];
    let issued = 0;
    const referred = validateWaitlistInput({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: "",
      referralToken: legacy,
    });
    assert.equal(referred.ok, true);
    if (!referred.ok) return;
    const second = await joinWaitlist(
      store,
      referred.value,
      () => "token-grace-aaaaaa",
      () => {
        const code = codes[issued] ?? "NewCode2";
        issued += 1;
        return code;
      },
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.token, "token-grace-aaaaaa");
    assert.equal(second.shortCode, "NewCode1");
    assert.equal(store.signups.length, 2);
    assert.equal(store.referrals.length, 1);
    assert.equal(store.signups[0]?.referralCode, legacy);
    const legacyView = await loadPublicReferral(store, legacy);
    assert.equal(legacyView.status, "ok");
    if (legacyView.status !== "ok") return;
    assert.equal(legacyView.referralCount, 1);
    assert.equal(legacyView.shareCode, "OldCode1");
    const shown = withShareUrl(second, "https://app.example:4000");
    assert.equal(shown.ok, true);
    if (!shown.ok) return;
    assert.equal(shown.shareUrl, "https://app.example:4000/?ref=NewCode1");
  });

  it("stops after repeated collisions without replacing the saved code", async () => {
    const store = memoryStore();
    const firstInput = validateWaitlistInput({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "",
      referralToken: "",
    });
    assert.equal(firstInput.ok, true);
    if (!firstInput.ok) return;
    await joinWaitlist(
      store,
      firstInput.value,
      () => "token-ada-aaaaaaaa",
      () => "AAAAAAAA",
    );
    const secondInput = validateWaitlistInput({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: "",
      referralToken: "",
    });
    assert.equal(secondInput.ok, true);
    if (!secondInput.ok) return;
    const blocked = await joinWaitlist(
      store,
      secondInput.value,
      () => "token-grace-aaaaaa",
      () => "AAAAAAAA",
    );
    assert.equal(blocked.ok, false);
    assert.equal(store.signups.length, 1);
    assert.equal(store.signups[0]?.referralCode, "token-ada-aaaaaaaa");
    assert.equal(store.signups[0]?.shortReferralCode, "AAAAAAAA");
    const kept = await loadPublicReferral(store, "AAAAAAAA");
    assert.equal(kept.status, "ok");
    if (kept.status !== "ok") return;
    assert.equal(kept.referralCount, 0);
    assert.equal(kept.shareCode, "AAAAAAAA");
  });
});
