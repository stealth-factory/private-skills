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

import { isCiCertificate, newCiCertificates } from "./asc-certificates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const scriptPath = join(HERE, "asc-certificates.mjs");

const cert = (id, certificateType, name) => ({ id, attributes: { certificateType, name } });
const mine = cert("MAC", "DEVELOPMENT", "Apple Development: A Person");
const before = cert("OLD", "DEVELOPMENT", "Apple Development: Created via API");
const fresh = cert("NEW", "DEVELOPMENT", "Apple Development: Created via API");
const distribution = cert("DIST", "DISTRIBUTION", "Apple Distribution: Created via API");

// Runs the real command against a stub App Store Connect: it serves the
// certificate list (failing the first `failFirst` reads with a 503) and
// records every request.
function run(args, certs, failFirst = 0) {
  const dir = mkdtempSync(join(tmpdir(), "asc-"));
  try {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    writeFileSync(join(dir, "key.p8"), privateKey.export({ type: "pkcs8", format: "pem" }));
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
    const snapshot = existsSync(join(dir, "before.json")) ? readFileSync(join(dir, "before.json"), "utf8") : null;
    return { status, stdout, deletes: requests.filter((r) => r.startsWith("DELETE")), requests, snapshot };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("TestFlight certificate clean-up", () => {
  it("revokes only API-made development certificates, and only new ones after a run", () => {
    assert.deepEqual(
      [mine, before, fresh, distribution].filter(isCiCertificate).map((c) => c.id),
      ["OLD", "NEW"],
    );
    const all = [mine, before, fresh, distribution, cert("MAC2", "DEVELOPMENT", "Apple Development: Someone")];
    assert.deepEqual(
      newCiCertificates(all, ["MAC", "OLD", "DIST"]).map((c) => c.id),
      ["NEW"],
    );
  });

  it("snapshot records the ids and deletes nothing", () => {
    const out = run(["snapshot", "$DIR/before.json"], [mine, before]);
    assert.equal(out.status, 0);
    assert.deepEqual(JSON.parse(out.snapshot ?? "null"), ["MAC", "OLD"]);
    assert.deepEqual(out.deletes, []);
  });

  it("revoke-new deletes only the certificate this run made", () => {
    const dir = mkdtempSync(join(tmpdir(), "asc-before-"));
    try {
      writeFileSync(join(dir, "before.json"), JSON.stringify(["MAC", "OLD"]));
      const out = run(["revoke-new", join(dir, "before.json")], [mine, before, fresh, distribution]);
      assert.equal(out.status, 0);
      assert.deepEqual(out.deletes, ["DELETE https://api.appstoreconnect.apple.com/v1/certificates/NEW"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("revoke-new without a snapshot sends no request and warns", () => {
    const out = run(["revoke-new", "$DIR/missing.json"], [mine, fresh]);
    assert.equal(out.status, 0);
    assert.deepEqual(out.requests, []);
    assert.match(out.stdout, /::warning::No certificate snapshot/);
  });

  it("prune lists without deleting, and deletes only CI certificates with --apply", () => {
    const dry = run(["prune"], [mine, before, fresh, distribution]);
    assert.equal(dry.status, 0);
    assert.deepEqual(dry.deletes, []);
    assert.match(dry.stdout, /would revoke {2}OLD/);
    const apply = run(["prune", "--apply"], [mine, before, fresh, distribution]);
    assert.equal(apply.status, 0);
    assert.deepEqual(
      apply.deletes.map((r) => r.split("/").pop()),
      ["OLD", "NEW"],
    );
  });

  it("retries a busy read and fails once the retries run out", () => {
    const recovered = run(["prune"], [before], 2);
    assert.equal(recovered.status, 0);
    assert.match(recovered.stdout, /would revoke {2}OLD/);
    const failed = run(["prune", "--apply"], [before], 10);
    assert.equal(failed.status, 1);
    assert.equal(failed.requests.filter((r) => r.startsWith("GET")).length, 4);
    assert.deepEqual(failed.deletes, []);
  });

  it("snapshots before the archive and revokes after every upload, pass or fail", () => {
    const testflight = readFileSync(join(ROOT, ".github", "workflows", "testflight.yml"), "utf8");
    const snapshot = testflight.indexOf("asc-certificates.mjs snapshot");
    const uploadJob = testflight.indexOf("\n  upload:");
    const archive = testflight.indexOf("xcodebuild archive");
    const upload = testflight.indexOf("xcodebuild -exportArchive");
    const revoke = testflight.indexOf("asc-certificates.mjs revoke-new");
    assert.ok(snapshot > -1, "snapshot step present");
    // Once, in the plan job, so parallel platform uploads never revoke each other's certificate.
    assert.ok(snapshot < uploadJob, "snapshot runs in the plan job, before the uploads");
    assert.ok(snapshot < archive, "snapshot runs before the archive");
    assert.ok(revoke > upload, "revoke runs after the upload");
    const job = testflight.slice(testflight.lastIndexOf("\n  certificates:", revoke), revoke);
    assert.match(job, /needs: \[plan, upload\]/);
    assert.match(job, /if: always\(\)/);
    assert.match(job, /continue-on-error: true/);

    const prune = readFileSync(join(ROOT, ".github", "workflows", "apple-certificates.yml"), "utf8");
    assert.match(prune, /workflow_dispatch/);
    assert.match(prune, /default: false/);
    assert.match(prune, /set -o pipefail/);
    // Never revokes the certificate of a TestFlight build that is signing, and
    // never replaces a pending upload while it waits.
    assert.match(prune, /group: testflight\n {2}cancel-in-progress: false\n {2}queue: max/);
  });
});
