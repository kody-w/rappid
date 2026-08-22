import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("installers resolve immutable public commits and stage atomically", () => {
  const shell = readFileSync(path.join(root, "install.sh"), "utf8");
  const powershell = readFileSync(path.join(root, "install.ps1"), "utf8");
  assert.match(shell, /commits\/\$REQUESTED_REF/);
  assert.match(shell, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(shell, /mv "\$STAGE" "\$INSTALL_ROOT"/);
  assert.match(shell, /npm run test:unit/);
  assert.match(shell, /resolved_ref/);
  assert.match(shell, /NODE_EXE="\$\(command -v node\)"/);
  assert.match(shell, /exec "\$NODE_EXE"/);
  assert.match(shell, /RAPP_ZOO_AUTOSTART/);
  assert.match(shell, /io\.github\.kody-w\.rapp-zoo-v2\.plist/);
  assert.match(shell, /Electron\.app\/Contents\/MacOS\/Electron/);
  assert.match(shell, /<key>KeepAlive<\/key>/);
  assert.match(powershell, /commits\/\$RequestedRef/);
  assert.match(powershell, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(powershell, /Move-Item \$Stage \$InstallRoot/);
  assert.match(powershell, /Move-Item \$Backup \$InstallRoot/);
  assert.match(powershell, /Installed app or launcher validation failed/);
  assert.match(powershell, /npm run test:unit/);
});

test("installer never touches the durable cage data root", () => {
  const shell = readFileSync(path.join(root, "install.sh"), "utf8");
  assert.equal(shell.includes('rm -rf -- "$HOME/.rapp-zoo-v2"'), false);
  assert.equal(shell.includes('RAPP_ZOO_ROOT="$INSTALL_ROOT"'), false);
  assert.match(shell, /"data_root": "\\\$HOME\/\.rapp-zoo-v2"/);
});
