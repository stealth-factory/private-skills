#!/usr/bin/env node
// Hands a tagged release's TestFlight builds to external testers.
//
// Run by .github/workflows/testflight.yml after a tag's uploads. For each
// platform it waits for App Store Connect to finish processing the build, sets
// its "What to Test" text from the changelog and adds it to the external group.
// Adding a build to an external group submits it for Beta App Review when the
// version needs one; the explicit submission below covers the case where it
// did not, and is skipped when the build is already submitted or approved. No dependencies: Node 20+ has fetch and
// ES256 signing built in.
//
// Environment:
//   APP_STORE_KEY_ID, APP_STORE_ISSUER_ID, APP_STORE_KEY_PATH   the API key (.p8 on disk)
//   BUNDLE_ID          the app's bundle id
//   VERSION            marketing version, e.g. 0.2.0
//   UPLOADED_AFTER     ISO time; older builds of the same version are ignored
//   EXTERNAL_GROUP     the external TestFlight group's name
//   WHATS_NEW_FILE     optional, text for "What to Test"
//   PLATFORMS          optional, default "IOS,MAC_OS"

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};

const keyId = env("APP_STORE_KEY_ID");
const issuerId = env("APP_STORE_ISSUER_ID");
const privateKey = readFileSync(env("APP_STORE_KEY_PATH"), "utf8");
const bundleId = env("BUNDLE_ID");
const version = env("VERSION");
const uploadedAfter = new Date(env("UPLOADED_AFTER"));
const groupName = env("EXTERNAL_GROUP");
const platforms = env("PLATFORMS", "IOS,MAC_OS").split(",");
const locale = process.env.WHATS_NEW_LOCALE || "en-AU";
// TestFlight caps "What to Test" at 4,000 characters.
const whatsNew = process.env.WHATS_NEW_FILE
  ? readFileSync(process.env.WHATS_NEW_FILE, "utf8").trim().slice(0, 4000)
  : "";

const base64url = (data) => Buffer.from(data).toString("base64url");

// App Store Connect tokens live at most 20 minutes; waiting for processing can
// take longer, so each request signs a fresh one.
function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }),
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${base64url(signature)}`;
}

async function asc(method, path, body) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + Number(process.env.WAIT_MINUTES || 75) * 60_000;

async function findBuild(appId, platform) {
  const query = new URLSearchParams({
    "filter[app]": appId,
    "filter[preReleaseVersion.version]": version,
    "filter[preReleaseVersion.platform]": platform,
    sort: "-uploadedDate",
    limit: "5",
  });
  // An upload takes a few minutes to appear and processing can take tens of
  // minutes. The deadline is shared by every platform, so two slow builds
  // cannot add up past the job's timeout.
  while (Date.now() < deadline) {
    const { data } = await asc("GET", `/v1/builds?${query}`);
    const build = data.find((b) => new Date(b.attributes.uploadedDate) >= uploadedAfter);
    if (build) {
      const state = build.attributes.processingState;
      if (state === "VALID") return build;
      if (state === "FAILED" || state === "INVALID") {
        throw new Error(`${platform} build ${build.attributes.version} is ${state} in App Store Connect`);
      }
      console.log(`${platform} build ${build.attributes.version}: ${state}`);
    } else {
      console.log(`${platform}: no ${version} build uploaded since ${uploadedAfter.toISOString()} yet`);
    }
    await sleep(30_000);
  }
  throw new Error(`${platform}: no processed ${version} build before the deadline`);
}

async function setWhatsNew(build) {
  if (!whatsNew) return;
  const { data } = await asc("GET", `/v1/builds/${build.id}/betaBuildLocalizations`);
  const existing = data.find((l) => l.attributes.locale === locale);
  if (existing) {
    await asc("PATCH", `/v1/betaBuildLocalizations/${existing.id}`, {
      data: { type: "betaBuildLocalizations", id: existing.id, attributes: { whatsNew } },
    });
  } else {
    await asc("POST", "/v1/betaBuildLocalizations", {
      data: {
        type: "betaBuildLocalizations",
        attributes: { locale, whatsNew },
        relationships: { build: { data: { type: "builds", id: build.id } } },
      },
    });
  }
}

// Already submitted, in review, approved or out to testers: nothing to submit.
const reviewedStates = new Set([
  "WAITING_FOR_BETA_REVIEW",
  "IN_BETA_REVIEW",
  "BETA_APPROVED",
  "READY_FOR_BETA_TESTING",
  "IN_BETA_TESTING",
]);

async function submitForReview(build, platform) {
  // The beta state can still read PROCESSING for a while after the build
  // itself is VALID, and adding it to the group may already have submitted it.
  while (true) {
    const { data } = await asc("GET", `/v1/builds/${build.id}/buildBetaDetail`);
    const state = data.attributes.externalBuildState;
    if (reviewedStates.has(state)) {
      console.log(`${platform}: ${state}`);
      return state;
    }
    if (state === "READY_FOR_BETA_SUBMISSION") {
      await asc("POST", "/v1/betaAppReviewSubmissions", {
        data: {
          type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: build.id } } },
        },
      });
      console.log(`${platform}: submitted for Beta App Review`);
      return "WAITING_FOR_BETA_REVIEW";
    }
    if (state !== "PROCESSING" || Date.now() > deadline) {
      throw new Error(`${platform} build ${build.attributes.version} is ${state}, which cannot be submitted`);
    }
    console.log(`${platform}: beta state ${state}`);
    await sleep(30_000);
  }
}

const { data: apps } = await asc("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
const app = apps.find((a) => a.attributes.bundleId === bundleId);
if (!app) throw new Error(`no App Store Connect app with bundle id ${bundleId}`);

const { data: groups } = await asc(
  "GET",
  `/v1/betaGroups?filter[app]=${app.id}&filter[isInternalGroup]=false&limit=50`,
);
const group = groups.find((g) => g.attributes.name === groupName);
if (!group) {
  const names = groups.map((g) => `"${g.attributes.name}"`).join(", ") || "none";
  throw new Error(
    `no external TestFlight group named "${groupName}" (external groups: ${names}). ` +
      "Create it in App Store Connect, or set the TESTFLIGHT_EXTERNAL_GROUP repository variable, then re-run this job.",
  );
}

// With automatic notification off, an approved build waits for someone to
// press Notify Testers; this release should reach testers on approval.
async function enableAutoNotify(build) {
  const { data } = await asc("GET", `/v1/builds/${build.id}/buildBetaDetail`);
  if (data.attributes.autoNotifyEnabled) return;
  await asc("PATCH", `/v1/buildBetaDetails/${data.id}`, {
    data: { type: "buildBetaDetails", id: data.id, attributes: { autoNotifyEnabled: true } },
  });
}

const summary = [];
for (const platform of platforms) {
  const build = await findBuild(app.id, platform);
  await setWhatsNew(build);
  await enableAutoNotify(build);
  await asc("POST", `/v1/betaGroups/${group.id}/relationships/builds`, {
    data: [{ type: "builds", id: build.id }],
  });
  console.log(`${platform}: build ${build.attributes.version} added to "${groupName}"`);
  const state = await submitForReview(build, platform);
  summary.push(`- ${platform}: ${version} (${build.attributes.version}) in "${groupName}", ${state}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `External testing\n\n${summary.join("\n")}\n`);
}
