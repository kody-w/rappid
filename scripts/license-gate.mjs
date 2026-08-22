import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const allowed = /^(?:MIT|ISC|BSD-[23]-Clause|Apache-2\.0|BlueOak-1\.0\.0)$/;
const failures = [];

function check(name, pass, detail = "") {
  console.log(`${pass ? " PASS" : "*FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!pass) failures.push(name);
}

check("project is MIT", project.license === "MIT");
check(
  "MIT license text ships",
  readFileSync(path.join(root, "LICENSE"), "utf8").startsWith("MIT License"),
);

const dependencies = new Set([
  ...Object.keys(project.dependencies || {}),
  ...Object.keys(project.devDependencies || {}),
]);
for (const name of [...dependencies].sort()) {
  const manifest = path.join(root, "node_modules", ...name.split("/"), "package.json");
  if (!existsSync(manifest)) {
    check(`dependency ${name}`, false, "not installed");
    continue;
  }
  const value = JSON.parse(readFileSync(manifest, "utf8"));
  const license = typeof value.license === "string"
    ? value.license
    : value.licenses?.map((entry) => entry.type || entry).join(" OR ");
  check(`dependency ${name}`, allowed.test(String(license)), String(license));
}

const legacyRuntime = [];
for (const directory of ["src", "ui", "bin"]) {
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/\.(?:c?js|mjs|html)$/.test(entry.name)) {
        const source = readFileSync(target, "utf8");
        if (/brainstem-egg|from flask|import flask/i.test(source)) {
          legacyRuntime.push(path.relative(root, target));
        }
      }
    }
  };
  walk(path.join(root, directory));
}
check(
  "no prehistoric runtime source copied",
  legacyRuntime.length === 0,
  legacyRuntime.join(", "),
);

console.log(`\n${failures.length ? "LICENSE GATE FAILED" : "LICENSE GATE PASSED"}`);
process.exit(failures.length ? 1 : 0);
