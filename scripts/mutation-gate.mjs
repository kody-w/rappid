import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mutants = [
  {
    name: "identity-domain-tag",
    file: "src/rapp1.mjs",
    from: 'const tail = Hb("rapp/1:rappid", uuidV4Octets(uuid));',
    to: 'const tail = Hb("rappid", uuidV4Octets(uuid));',
    test: "tests/rapp1.test.mjs",
  },
  {
    name: "jcs-proto-collision",
    file: "src/rapp1.mjs",
    from: "const result = Object.create(null);\n  for (const key of Object.keys(value).sort())",
    to: "const result = {};\n  for (const key of Object.keys(value).sort())",
    test: "tests/rapp1.test.mjs",
  },
  {
    name: "wire-extra-member",
    file: "src/rapp1.mjs",
    from: 'new Set(["user_input", "session_id", "idempotency_key"])',
    to: 'new Set(["user_input", "session_id", "idempotency_key", "conversation_history"])',
    test: "tests/rapp1.test.mjs",
  },
  {
    name: "mutable-raw-url",
    file: "src/global-object.mjs",
    from: "|| !COMMIT.test(segments[2])",
    to: "|| false",
    test: "tests/global-object.test.mjs",
  },
  {
    name: "remote-drill-receipt",
    file: "src/local-drill.mjs",
    from: '|| /^https?:\\/\\//i.test(receiptFile)',
    to: "|| false",
    test: "tests/local-drill.test.mjs",
  },
  {
    name: "partial-summon-save",
    file: "src/local-drill.mjs",
    from: "|| declaredNames.length !== loadedNames.length\n      || declaredNames.some((name, index) => name !== loadedNames[index])",
    to: "|| false",
    test: "tests/local-drill.test.mjs",
  },
  {
    name: "catalog-duplicate-rappid",
    file: "src/summon-library.mjs",
    from: "const conflict = library.entries.find((candidate) => (\n          candidate.alias === entry.alias\n          || candidate.rappid === entry.rappid\n        ));",
    to: "const conflict = library.entries.find((candidate) => (\n          candidate.alias === entry.alias\n        ));",
    test: "tests/summon-library.test.mjs",
  },
  {
    name: "transfer-invalid-utf8",
    file: "src/prototype-transfer.mjs",
    from: 'decodeUtf8(\n        readFileSync(path.resolve(transferFile)),\n        "Prototype transfer",\n      )',
    to: 'readFileSync(path.resolve(transferFile)).toString("utf8")',
    test: "tests/prototype-transfer.test.mjs",
  },
  {
    name: "transfer-inbound-size",
    file: "src/prototype-transfer.mjs",
    from: 'if (totalBytes > MAX_TRANSFER_BYTES) {\n      throw new Error("Prototype transfer exceeds the portable prototype limit.");\n    }',
    to: "if (false) { throw new Error(); }",
    test: "tests/prototype-transfer.test.mjs",
  },
  {
    name: "generic-health-200",
    file: "src/chat-client.mjs",
    from: '|| value.status !== "ok"',
    to: "|| false",
    test: "tests/chat-client.test.mjs",
  },
  {
    name: "capability-stop-bypass",
    file: "src/control-server.mjs",
    from: 'if (request.headers.authorization !== `Bearer ${instanceToken}`) {',
    to: "if (false) {",
    test: "tests/control-server.test.mjs",
  },
  {
    name: "arbitrary-autopilot",
    file: "src/autopilot-server.mjs",
    from: "export function validateAutopilotCommand(value) {\n",
    to: "export function validateAutopilotCommand(value) {\n  return value;\n",
    test: "tests/autopilot-server.test.mjs",
  },
  {
    name: "deterministic-majority-pass",
    file: "src/simulation-neighborhood.mjs",
    from: "? leader.replicas.length === plan.replicas",
    to: "? leader.replicas.length >= Math.ceil(plan.replicas * 0.94)",
    test: "tests/simulation-neighborhood.test.mjs",
  },
];

const results = [];
for (const mutant of mutants) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-mutant-"));
  try {
    cpSync(path.join(root, "src"), path.join(temporary, "src"), {
      recursive: true,
    });
    cpSync(path.join(root, "tests"), path.join(temporary, "tests"), {
      recursive: true,
    });
    writeFileSync(
      path.join(temporary, "package.json"),
      '{"type":"module","private":true}\n',
    );
    const file = path.join(temporary, mutant.file);
    const source = readFileSync(file, "utf8");
    if (!source.includes(mutant.from)) {
      throw new Error(`${mutant.name} mutation target no longer exists.`);
    }
    writeFileSync(file, source.replace(mutant.from, mutant.to));
    const result = spawnSync(
      process.execPath,
      ["--test", mutant.test],
      {
        cwd: temporary,
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    const caught = result.status !== 0;
    results.push({ name: mutant.name, caught });
    console.log(`${caught ? " PASS" : "*FAIL"}  mutant ${mutant.name} ${
      caught ? "was caught" : "survived"
    }`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const missed = results.filter((result) => !result.caught);
console.log(`\n${results.length - missed.length}/${results.length} mutants caught`);
process.exit(missed.length ? 1 : 0);
