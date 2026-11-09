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
//   revoke-own <pem>     revoke the development certificates whose serial
//                        numbers are in <pem>: the certificates in this
//                        runner's keychain, which this job made
//   prune [--apply]      list every development certificate created via the
//                        API, and revoke them with --apply
//
// revoke-own matches by serial number, so it never touches a certificate that
// another job, or another repository building on the same Apple team, is still
// signing with. Telling them apart by time (what existed before the build)
// is not enough: the workflows' concurrency group only covers one repository.
//
// Only development certificates whose name says "Created via API" are ever
// revoked. A certificate Xcode made on a person's Mac carries that person's
// name instead, so it is never touched. Revoking a development certificate
// does not affect builds already on TestFlight or the App Store.
//
// Environment: APP_STORE_KEY_ID, APP_STORE_ISSUER_ID, APP_STORE_KEY_PATH.
// No dependencies: Node 20+ has fetch and ES256 signing built in.

import { X509Certificate, createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

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

/** A serial number in one spelling: upper-case hex, no separators or leading zeros. */
export function normaliseSerial(serial) {
  return String(serial ?? "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .replace(/^0+(?=.)/, "");
}

/** The serial numbers of every certificate in a PEM bundle (`security find-certificate -p`). */
export function serialsFromPem(text) {
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return blocks.map((block) => normaliseSerial(new X509Certificate(block).serialNumber));
}

/** CI certificates whose serial number is one of `serials`: the ones this job holds. */
export function ownCiCertificates(current, serials) {
  const own = new Set(serials.map(normaliseSerial));
  return current.filter((cert) => isCiCertificate(cert) && own.has(normaliseSerial(cert.attributes?.serialNumber)));
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
    case "revoke-own": {
      if (!arg) throw new Error("usage: revoke-own <pem>");
      // Nothing in the keychain: the job stopped before it signed, or Xcode
      // kept the certificate somewhere the workflow did not look. Without a
      // serial number this job's certificate can't be told from another
      // job's, so revoke nothing and say so.
      const serials = existsSync(arg) ? serialsFromPem(readFileSync(arg, "utf8")) : [];
      if (serials.length === 0) {
        console.log(
          "::warning::No development certificate in this runner's keychain, so nothing was revoked. If the build signed, it may have left one; run the Apple certificates workflow to clear it.",
        );
        return;
      }
      const own = ownCiCertificates(await listDevelopmentCertificates(), serials);
      if (own.length === 0) {
        console.log("This job left no development certificate on the team.");
        return;
      }
      // A failed revoke is a warning, never a failed upload: the build is already out.
      await revoke(own);
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
      throw new Error("usage: asc-certificates.mjs revoke-own <pem> | prune [--apply]");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
