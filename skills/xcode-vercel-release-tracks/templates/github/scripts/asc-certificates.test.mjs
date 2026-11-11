// Tests for asc-certificates.mjs. Run with `node --test '.github/scripts/*.test.mjs'`
// (Node 22 needs the glob; a bare directory is not found). Node's own test runner,
// so no dependencies.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { isCiCertificate, normaliseSerial, ownCiCertificates, serialsFromPem } from "./asc-certificates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const scriptPath = join(HERE, "asc-certificates.mjs");

// A self-signed certificate with serial number A1B2C3D4E5F6 (written 00A1B2C3D4E5F6),
// standing in for the one Xcode leaves in the runner's keychain.
const KEYCHAIN_PEM = `-----BEGIN CERTIFICATE-----
MIIBtjCCAVygAwIBAgIHAKGyw9Tl9jAKBggqhkjOPQQDAjA3MTUwMwYDVQQDDCxB
cHBsZSBEZXZlbG9wbWVudDogQ3JlYXRlZCB2aWEgQVBJIChURUFNMTIzKTAeFw0y
NjExMDkyMjMzMTJaFw0yNjExMTAyMjMzMTJaMDcxNTAzBgNVBAMMLEFwcGxlIERl
dmVsb3BtZW50OiBDcmVhdGVkIHZpYSBBUEkgKFRFQU0xMjMpMFkwEwYHKoZIzj0C
AQYIKoZIzj0DAQcDQgAEiymp+gcv0jpejBnADHPKPKuwz4xw6wK66IVXSUXfXi/G
sGnB6AJwFpeKP8pa/JaViu/M0PitdjeVAYMDjrbjlqNTMFEwHQYDVR0OBBYEFCP1
jBua/gWOaj+R0kWoVwzbxyTjMB8GA1UdIwQYMBaAFCP1jBua/gWOaj+R0kWoVwzb
xyTjMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgEYDkuM1eor8y
xN8B6EmU07Iqs7c8lkod1ezdPdbCAZwCIQCvVBJltsBeJSiSz37MCUUKjuWgw9cg
/qm5V7ShTiO9wg==
-----END CERTIFICATE-----
`;

const cert = (id, certificateType, name, serialNumber) => ({
  id,
  attributes: { certificateType, name, serialNumber },
});
const mine = cert("MAC", "DEVELOPMENT", "Apple Development: A Person", "A1B2C3D4E5F6");
const other = cert("OTHER", "DEVELOPMENT", "Apple Development: Created via API", "0BADC0FFEE");
const own = cert("OWN", "DEVELOPMENT", "Apple Development: Created via API", "a1b2c3d4e5f6");
const distribution = cert("DIST", "DISTRIBUTION", "Apple Distribution: Created via API", "A1B2C3D4E5F6");

// Runs the real command against a stub App Store Connect: it serves the
// certificate list (failing the first `failFirst` reads with a 503) and
// records every request.
function run(args, certs, failFirst = 0, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "asc-"));
  try {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    writeFileSync(join(dir, "key.p8"), privateKey.export({ type: "pkcs8", format: "pem" }));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const log = join(dir, "requests.log");
    writeFileSync(
      join(dir, "stub.mjs"),
      `import { appendFileSync } from 'node:fs';
let reads = 0;
globalThis.fetch = async (url, { method }) => {
  appendFileSync(${JSON.stringify(log)}, method + ' ' + url + '\\n');
  if (method === 'DELETE') return new Response(null, { status: 204 });
  if (reads++ < ${failFirst}) return new Response('busy', { status: 503 });
  return new Response(JSON.stringify({ data: ${JSON.stringify(certs)}, links: {} }), { status: 200 });
};`,
    );
    const resolved = args.map((a) => a.replace("$DIR", dir));
    let status = 0;
    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, ["--import", join(dir, "stub.mjs"), scriptPath, ...resolved], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          APP_STORE_KEY_ID: "KEY",
          APP_STORE_ISSUER_ID: "ISSUER",
          APP_STORE_KEY_PATH: join(dir, "key.p8"),
          ASC_RETRY_MS: "1",
        },
      });
    } catch (error) {
      status = error.status;
    }
    const requests = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { status, stdout, deletes: requests.filter((r) => r.startsWith("DELETE")), requests };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("TestFlight certificate clean-up", () => {
  it("revokes only API-made development certificates, and only this job's by serial number", () => {
    assert.deepEqual(
      [mine, other, own, distribution].filter(isCiCertificate).map((c) => c.id),
      ["OTHER", "OWN"],
    );
    assert.equal(normaliseSerial("00:a1:B2"), "A1B2");
    assert.equal(normaliseSerial("0"), "0");
    assert.deepEqual(serialsFromPem(KEYCHAIN_PEM + KEYCHAIN_PEM), ["A1B2C3D4E5F6", "A1B2C3D4E5F6"]);
    assert.deepEqual(serialsFromPem("no certificates here"), []);
    assert.deepEqual(
      ownCiCertificates([mine, other, own, distribution], ["00A1B2C3D4E5F6"]).map((c) => c.id),
      ["OWN"],
    );
  });

  it("revoke-own deletes only the certificate in this runner's keychain", () => {
    const out = run(["revoke-own", "$DIR/signing.pem"], [mine, other, own, distribution], 0, {
      "signing.pem": KEYCHAIN_PEM,
    });
    assert.equal(out.status, 0);
    assert.deepEqual(out.deletes, ["DELETE https://api.appstoreconnect.apple.com/v1/certificates/OWN"]);
  });

  it("revoke-own with an empty or missing keychain export sends no request and warns", () => {
    for (const files of [{}, { "signing.pem": "" }]) {
      const out = run(["revoke-own", "$DIR/signing.pem"], [other, own], 0, files);
      assert.equal(out.status, 0);
      assert.deepEqual(out.requests, []);
      assert.match(out.stdout, /::warning::This job added no development certificate to the Mac's keychain/);
    }
  });

  it("prune lists without deleting, and deletes only CI certificates with --apply", () => {
    const dry = run(["prune"], [mine, other, own, distribution]);
    assert.equal(dry.status, 0);
    assert.deepEqual(dry.deletes, []);
    assert.match(dry.stdout, /would revoke {2}OTHER/);
    const apply = run(["prune", "--apply"], [mine, other, own, distribution]);
    assert.equal(apply.status, 0);
    assert.deepEqual(
      apply.deletes.map((r) => r.split("/").pop()),
      ["OTHER", "OWN"],
    );
  });

  it("retries a busy read and fails once the retries run out", () => {
    const recovered = run(["prune"], [other], 2);
    assert.equal(recovered.status, 0);
    assert.match(recovered.stdout, /would revoke {2}OTHER/);
    const failed = run(["prune", "--apply"], [other], 10);
    assert.equal(failed.status, 1);
    assert.equal(failed.requests.filter((r) => r.startsWith("GET")).length, 4);
    assert.deepEqual(failed.deletes, []);
  });

  it("revokes in each upload job after the upload, pass or fail", () => {
    const testflight = readFileSync(join(ROOT, ".github", "workflows", "testflight.yml"), "utf8");
    const uploadJob = testflight.indexOf("\n  upload:");
    const upload = testflight.indexOf("xcodebuild -exportArchive");
    const revoke = testflight.indexOf("asc-certificates.mjs\" revoke-own");
    const external = testflight.indexOf("\n  external:");
    assert.ok(revoke > -1, "revoke step present");
    assert.ok(revoke > upload && upload > uploadJob, "revoke runs after the upload");
    assert.ok(revoke < external, "revoke runs in the upload job, on the runner that holds the keychain");
    const step = testflight.slice(testflight.lastIndexOf("- name:", revoke), revoke);
    assert.match(step, /if: always\(\) && env\.CI_SIGNING_LOCK != ''/);
    assert.match(step, /continue-on-error: true/);
    assert.match(step, /security find-certificate -a -Z -p -c "Apple Development"/);
    assert.match(step, /certs\.before/, "revokes only certificates added since the lock was taken");

    // Self-hosted Macs only: never a GitHub-hosted macOS label, and the signing lock is
    // taken before the API key is installed and released by the job's last step.
    const job = testflight.slice(uploadJob, external);
    assert.doesNotMatch(testflight, /runs-on:\s*macos-/);
    assert.match(job, /runs-on: \$\{\{ fromJSON\(vars\.MACOS_RUNS_ON \|\| '\["self-hosted","macOS","ARM64"\]'\) \}\}/);
    const lock = job.indexOf("- name: Take signing lock");
    assert.ok(lock > -1 && lock < job.indexOf("- name: Install API key"), "lock taken before the key is installed");
    const steps = job.split("\n      - name: ");
    assert.match(steps.at(-1), /^Release signing lock\n\s+if: always\(\)/);

    const prune = readFileSync(join(ROOT, ".github", "workflows", "apple-certificates.yml"), "utf8");
    assert.match(prune, /workflow_dispatch/);
    assert.match(prune, /default: false/);
    assert.match(prune, /set -o pipefail/);
    // Never revokes the certificate of this repository's TestFlight build that is
    // signing, and never replaces a pending upload while it waits.
    assert.match(prune, /group: testflight\n {2}cancel-in-progress: false\n {2}queue: max/);
  });
});
