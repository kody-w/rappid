import { pinnedRawUrl } from "./global-object.mjs";

export const SUMMON_CHANT_SCHEMA = "rapp-zoo-summon-chant/2.0";
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export function createSummonChant({ manifestUrl, manifestSha256 }) {
  if (!SHA256.test(String(manifestSha256))) {
    throw new Error("Summon Chant requires an exact lowercase SHA-256.");
  }
  const raw = new URL(pinnedRawUrl(manifestUrl));
  const [owner, repo, commit, ...manifestPath] = raw.pathname
    .split("/")
    .filter(Boolean);
  if (!owner || !repo || !COMMIT.test(commit) || manifestPath.length === 0) {
    throw new Error("Summon Chant source is incomplete.");
  }
  const chant = new URL("rapp-summon://github/");
  chant.pathname = [
    owner,
    repo,
    commit,
    ...manifestPath,
  ].map(encodeURIComponent).join("/");
  chant.searchParams.set("sha256", manifestSha256);
  return chant.href;
}

export function parseSummonChant(value) {
  let chant;
  try {
    chant = new URL(String(value));
  } catch {
    throw new Error("Summon Chant must be a valid URI.");
  }
  const segments = chant.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, repo, commit, ...manifestPath] = segments;
  const sha256 = chant.searchParams.get("sha256");
  if (
    chant.protocol !== "rapp-summon:"
    || chant.hostname !== "github"
    || chant.username
    || chant.password
    || chant.hash
    || [...chant.searchParams.keys()].some((key) => key !== "sha256")
    || !owner
    || !repo
    || !COMMIT.test(commit)
    || manifestPath.length === 0
    || !SHA256.test(String(sha256))
  ) {
    throw new Error("Summon Chant violates the immutable v2 grammar.");
  }
  const manifestUrl = pinnedRawUrl(
    `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${
      manifestPath.map(encodeURIComponent).join("/")
    }`,
  );
  return {
    schema: SUMMON_CHANT_SCHEMA,
    chant: chant.href,
    owner,
    repo,
    commit,
    manifest_path: manifestPath.join("/"),
    manifest_url: manifestUrl,
    manifest_sha256: sha256,
  };
}
