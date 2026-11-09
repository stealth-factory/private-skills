#!/usr/bin/env node
// Revokes the Apple Development certificates that TestFlight CI leaves behind.
//
// testflight.yml archives with automatic signing on a fresh GitHub Mac. Xcode
// makes a new private key there and asks Apple for a new development
// certificate ("Apple Development: Created via API"). The runner is wiped
// afterwards, so the certificate stays on the team but can never sign anything
// again, and once enough pile up Apple refuses to issue another.
//
// Commands:
//   snapshot <file>      write the ids of the team's development certificates
//   revoke-new <file>    revoke development certificates created via the API
//                        that are not in <file>: the ones this run made
//   prune [--apply]      list every development certificate created via the
//                        API, and revoke them with --apply
//
// Only development certificates whose name says "Created via API" are ever
// revoked. A certificate Xcode made on a person's Mac carries that person's
// name instead, so it is never touched. Revoking a development certificate
// does not affect builds already on TestFlight or the App Store.
//
// Environment: APP_STORE_KEY_ID, APP_STORE_ISSUER_ID, APP_STORE_KEY_PATH.
// No dependencies: Node 20+ has fetch and ES256 signing built in.

import { createSign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const DEVELOPMENT_TYPES = ["DEVELOPMENT", "IOS_DEVELOPMENT"];
const CI_MARKER = "Created via API";

/** A development certificate that an API key, not a person's Xcode, created. */
export function isCiCertificate(cert) {
  const { certificateType, name = "", displayName = "" } = cert.attributes ?? {};
  return (
    DEVELOPMENT_TYPES.includes(certificateType) &&
    (name.includes(CI_MARKER) || displayName.includes(CI_MARKER))
  );
}

/** CI certificates that were not there before the run. */
export function newCiCertificates(current, before) {
  const known = new Set(before);
  return current.filter((cert) => !known.has(cert.id) && isCiCertificate(cert));
}

const describe = (cert) => {
  const a = cert.attributes ?? {};
  return `${cert.id}  ${a.name ?? a.displayName ?? "?"}  serial ${a.serialNumber ?? "?"}  expires ${a.expirationDate ?? "?"}`;
};

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const base64url = (data) => Buffer.from(data).toString("base64url");

function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: env("APP_STORE_KEY_ID"), typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: env("APP_STORE_ISSUER_ID"), iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }),
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign({
    key: readFileSync(env("APP_STORE_KEY_PATH"), "utf8"),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reads retry a dropped connection, a 429 or a 5xx, so a hiccup at Apple does
// not stop a release. A DELETE is tried once: it may have landed before the error.
async function asc(method, url) {
  const attempts = method === "GET" ? 4 : 1;
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url.startsWith("http") ? url : `https://api.appstoreconnect.apple.com${url}`, {
        method,
        headers: { authorization: `Bearer ${token()}` },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(Number(process.env.ASC_RETRY_MS ?? 5_000) * attempt);
      continue;
    }
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : null;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= attempts) {
      throw new Error(`${method} ${url}: ${response.status} ${text.slice(0, 500)}`);
    }
    await sleep(Number(process.env.ASC_RETRY_MS ?? 5_000) * attempt);
  }
}

async function listDevelopmentCertificates() {
  const certs = [];
  let next =
    `/v1/certificates?filter[certificateType]=${DEVELOPMENT_TYPES.join(",")}` +
    "&fields[certificates]=name,displayName,certificateType,serialNumber,expirationDate&limit=200";
  while (next) {
    const page = await asc("GET", next);
    certs.push(...page.data);
    next = page.links?.next;
  }
  return certs;
}

async function revoke(certs) {
  let failed = 0;
  for (const cert of certs) {
    try {
      await asc("DELETE", `/v1/certificates/${cert.id}`);
      console.log(`revoked  ${describe(cert)}`);
    } catch (error) {
      failed++;
      console.log(`::warning::could not revoke ${cert.id}: ${error.message}`);
    }
  }
  return failed;
}

async function main([command, arg]) {
  switch (command) {
    case "snapshot": {
      if (!arg) throw new Error("usage: snapshot <file>");
      const certs = await listDevelopmentCertificates();
      writeFileSync(arg, JSON.stringify(certs.map((cert) => cert.id)));
      console.log(`${certs.length} development certificate(s) before the build.`);
      return;
    }
    case "revoke-new": {
      if (!arg) throw new Error("usage: revoke-new <file>");
      // No snapshot: either the run stopped before it signed anything, or the
      // snapshot step failed and the build went ahead. Without a baseline this
      // run's certificate can't be told apart, so revoke nothing and say so.
      if (!existsSync(arg)) {
        console.log(
          "::warning::No certificate snapshot, so nothing was revoked. If the build signed, it may have left a development certificate; run the Apple certificates workflow to clear it.",
        );
        return;
      }
      const fresh = newCiCertificates(await listDevelopmentCertificates(), JSON.parse(readFileSync(arg, "utf8")));
      if (fresh.length === 0) {
        console.log("This run left no new development certificate.");
        return;
      }
      // A failed revoke is a warning, never a failed upload: the build is already out.
      await revoke(fresh);
      return;
    }
    case "prune": {
      const apply = arg === "--apply";
      const ci = (await listDevelopmentCertificates()).filter(isCiCertificate);
      if (ci.length === 0) {
        console.log("No development certificates created via the API.");
        return;
      }
      if (!apply) {
        for (const cert of ci) console.log(`would revoke  ${describe(cert)}`);
        console.log(`${ci.length} certificate(s). Run again with apply to revoke them.`);
        return;
      }
      if ((await revoke(ci)) > 0) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("usage: asc-certificates.mjs snapshot <file> | revoke-new <file> | prune [--apply]");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
