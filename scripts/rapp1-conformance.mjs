import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RAPP1_SPEC_BYTES,
  RAPP1_SPEC_SHA256,
} from "../src/rapp1.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authority = JSON.parse(
  readFileSync(path.join(root, "conformance", "authority.json"), "utf8"),
);
const failures = [];

function check(name, pass, detail = "") {
  console.log(`${pass ? " PASS" : "*FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!pass) failures.push(name);
}

check(
  "authority schema",
  authority.schema === "rapp-zoo-rapp1-authority/1.0",
);
check(
  "latest rev-5 metadata pin",
  authority.standard_repository.revision === "rev-5"
    && authority.standard_repository.wire_tag === "rapp/1"
    && authority.standard_repository.bytes === RAPP1_SPEC_BYTES
    && authority.standard_repository.sha256 === RAPP1_SPEC_SHA256,
);
check(
  "monorepo snapshot pin",
  /^[0-9a-f]{40}$/.test(authority.monorepo.commit)
    && authority.monorepo.manifest_schema === "rapp-monorepo/1.0",
);
check(
  "external acceptance remains separately measured",
  authority.claim_policy.ecosystem_acceptance
    === "blocked-on-external-owner-evidence"
    && authority.measured_gates.spine_verifier.failed_invariants
      .includes("I12_completion_receipt"),
);

const monorepo = process.env.RAPP_MONOREPO_PATH;
if (monorepo) {
  const manifest = JSON.parse(
    readFileSync(path.join(monorepo, "MANIFEST.json"), "utf8"),
  );
  const spec = path.join(monorepo, "repos", "rapp-1", "SPEC.md");
  const bytes = readFileSync(spec);
  const entry = manifest.repos.find((candidate) => candidate.repo === "rapp-1");
  check(
    "local monorepo manifest pin",
    manifest.schema === authority.monorepo.manifest_schema
      && manifest.captured_at === authority.monorepo.captured_at
      && entry?.commit === authority.standard_repository.snapshot_commit,
  );
  check(
    "local monorepo spec bytes",
    statSync(spec).size === RAPP1_SPEC_BYTES
      && createHash("sha256").update(bytes).digest("hex") === RAPP1_SPEC_SHA256,
  );
} else {
  check(
    "offline authority fixture available",
    existsSync(path.join(root, "conformance", "authority.json")),
    "set RAPP_MONOREPO_PATH for byte-level snapshot revalidation",
  );
}

console.log(`\n${failures.length ? "NOT CONFORMANT" : "AUTHORITY PIN CONFORMANT"}`);
process.exit(failures.length ? 1 : 0);
