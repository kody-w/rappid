import { createHash } from "node:crypto";
import {
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writePrivateJson } from "../src/estate-store.mjs";
import { mintRappid } from "../src/rapp1.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "examples", "hello-cage");
const sourceCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(String(sourceCommit))) {
  throw new Error("Usage: node scripts/build-example-manifest.mjs <40-char source commit>");
}
const outputFile = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(directory, "manifest.json");

const sourceRappid = mintRappid("kody-w", "hello-cage", {
  uuid: "00000000-0000-4000-8000-000000000060",
});
const types = {
  "template.json": "application/json",
  "handoff.md": "text/markdown",
  LICENSE: "text/plain",
};
const dimensions = Object.entries(types).map(([file, mediaType]) => {
  const bytes = readFileSync(path.join(directory, file));
  const name = file === "template.json"
    ? "template"
    : file === "handoff.md"
      ? "handoff"
      : "license";
  return {
    name,
    url:
      `https://raw.githubusercontent.com/kody-w/rapp-zoo-v2/${sourceCommit}/examples/hello-cage/${file}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    media_type: mediaType,
  };
}).sort((left, right) => left.name.localeCompare(right.name));

writePrivateJson(outputFile, {
  schema: "rapp-zoo-global-object/2.0",
  name: "Hello Cage",
  source_rappid: sourceRappid,
  created_utc: "2026-08-22T17:30:00.000Z",
  dimensions,
});
console.log(outputFile);
