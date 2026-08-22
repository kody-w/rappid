import {
  mintRappid,
  validateRappid,
} from "./rapp1.mjs";

export const ESTATE_SCHEMA = "rapp-zoo-estate/2.0";
export const NEIGHBORHOOD_SCHEMA = "rapp-zoo-neighborhood/2.0";
export const CONTROL_SCHEMA = "rapp-zoo-control/2.0";
export const OPERATION_SCHEMA = "rapp-zoo-operation/2.0";
export const REPORT_SCHEMA = "rapp-zoo-morning-handoff/2.0";
export const MAX_DIRECT_CHILDREN = 32;
export const MAX_GENERATION = 8;

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ESTATE_KEYS = [
  "schema",
  "estate_id",
  "rappid",
  "root_neighborhood_id",
  "name",
  "slug",
  "app_name",
  "dock_badge",
  "parent_estate_id",
  "parent_neighborhood_id",
  "generation",
  "created_utc",
  "neighborhoods",
];
const NEIGHBORHOOD_KEYS = [
  "schema",
  "kind",
  "estate_id",
  "rappid",
  "name",
  "adapter",
  "base_url",
  "attached_utc",
];

function exactKeys(value, keys, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has unknown or missing members.`);
  }
}

function text(value, label, { max = 120, allowEmpty = false } = {}) {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || value.length > max
    || value !== value.normalize("NFC")
  ) {
    throw new Error(`${label} must be a ${allowEmpty ? "" : "non-empty "}NFC string.`);
  }
  return value;
}

export function utc(value, label = "UTC timestamp") {
  if (typeof value !== "string" || !UTC.test(value)) {
    throw new Error(`${label} must use the exact RAPP UTC form.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a calendar-valid RAPP UTC timestamp.`);
  }
  return value;
}

export function slugify(value) {
  const slug = text(String(value || ""), "Estate name", { max: 80 })
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!slug || slug.length > 64 || !SLUG.test(slug)) {
    throw new Error("Estate name must produce a 1-64 character safe slug.");
  }
  return slug;
}

export function normalizeLoopbackBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error("Neighborhood base_url must be an absolute URL.");
  }
  if (
    parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(
      "Neighborhood base_url must be an explicit http://127.0.0.1:<port>/ origin.",
    );
  }
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Neighborhood base_url carries an invalid port.");
  }
  return parsed.origin;
}

function badge(slug, tail) {
  const initials = slug.split("-")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return `${initials || "Z"}${tail.slice(0, 2).toUpperCase()}`.slice(0, 4);
}

export function validateNeighborhood(value, {
  estateId = null,
  rootRappid = null,
} = {}) {
  exactKeys(value, NEIGHBORHOOD_KEYS, "Neighborhood");
  if (value.schema !== NEIGHBORHOOD_SCHEMA) {
    throw new Error("Neighborhood schema is not supported.");
  }
  if (!["root", "resident"].includes(value.kind)) {
    throw new Error("Neighborhood kind must be root or resident.");
  }
  if (!validateRappid(value.rappid)) {
    throw new Error("Neighborhood rappid violates RAPP/1 section 6.1.");
  }
  text(value.name, "Neighborhood name", { max: 80 });
  utc(value.attached_utc, "Neighborhood attached_utc");
  if (estateId && value.estate_id !== estateId) {
    throw new Error("A foreign neighborhood cannot enter this estate.");
  }
  if (value.kind === "root") {
    if (
      value.rappid !== rootRappid
      || value.adapter !== null
      || value.base_url !== null
    ) {
      throw new Error("Root neighborhood conflicts with estate identity.");
    }
  } else {
    if (value.adapter !== "rapp/1") {
      throw new Error("Resident neighborhoods must use the exact RAPP/1 adapter.");
    }
    normalizeLoopbackBaseUrl(value.base_url);
  }
  return value;
}

export function validateEstate(value) {
  exactKeys(value, ESTATE_KEYS, "Estate");
  if (value.schema !== ESTATE_SCHEMA) {
    throw new Error("Estate schema is not supported.");
  }
  if (!validateRappid(value.rappid)) {
    throw new Error("Estate rappid violates RAPP/1 section 6.1.");
  }
  if (
    value.estate_id !== `estate:${value.rappid}`
    || value.root_neighborhood_id !== value.rappid
  ) {
    throw new Error("Estate identity fields disagree.");
  }
  text(value.name, "Estate name", { max: 80 });
  text(value.app_name, "Estate app_name", { max: 120 });
  text(value.dock_badge, "Estate dock_badge", { max: 4, allowEmpty: true });
  if (!SLUG.test(value.slug) || value.slug.length > 64) {
    throw new Error("Estate slug is invalid.");
  }
  if (
    !Number.isSafeInteger(value.generation)
    || value.generation < 0
    || value.generation > MAX_GENERATION
  ) {
    throw new Error(`Estate generation must be between 0 and ${MAX_GENERATION}.`);
  }
  if (value.generation === 0) {
    if (value.parent_estate_id !== null || value.parent_neighborhood_id !== null) {
      throw new Error("A root estate cannot declare parent lineage.");
    }
  } else if (
    typeof value.parent_estate_id !== "string"
    || !value.parent_estate_id.startsWith("estate:rappid:@")
    || !validateRappid(value.parent_neighborhood_id)
  ) {
    throw new Error("A child estate must carry valid parent lineage.");
  }
  utc(value.created_utc, "Estate created_utc");
  if (!Array.isArray(value.neighborhoods) || value.neighborhoods.length === 0) {
    throw new Error("Estate must contain its root neighborhood.");
  }
  const seen = new Set();
  let roots = 0;
  for (const neighborhood of value.neighborhoods) {
    validateNeighborhood(neighborhood, {
      estateId: value.estate_id,
      rootRappid: value.root_neighborhood_id,
    });
    if (seen.has(neighborhood.rappid)) {
      throw new Error("Estate neighborhood rappids must be unique.");
    }
    seen.add(neighborhood.rappid);
    if (neighborhood.kind === "root") roots += 1;
  }
  if (roots !== 1 || value.neighborhoods[0].kind !== "root") {
    throw new Error("Estate must contain exactly one leading root neighborhood.");
  }
  return value;
}

export function createEstateManifest({
  name = "Primary",
  generation = 0,
  parentEstateId = null,
  parentNeighborhoodId = null,
  createdUtc = new Date().toISOString(),
  uuid,
} = {}) {
  const safeName = text(name, "Estate name", { max: 80 });
  const slug = slugify(safeName);
  const rappSlug = generation === 0
    ? "rapp-zoo-v2"
    : `rapp-zoo-v2-${slug}`.slice(0, 100).replace(/-+$/g, "");
  const rappid = mintRappid("kody-w", rappSlug, { uuid });
  const estateId = `estate:${rappid}`;
  const tail = rappid.slice(-64);
  const manifest = {
    schema: ESTATE_SCHEMA,
    estate_id: estateId,
    rappid,
    root_neighborhood_id: rappid,
    name: safeName,
    slug,
    app_name: generation === 0
      ? "RAPP Zoo v2"
      : `RAPP Zoo v2 · ${safeName} · ${tail.slice(0, 4)}`,
    dock_badge: generation === 0 ? "Z2" : badge(slug, tail),
    parent_estate_id: parentEstateId,
    parent_neighborhood_id: parentNeighborhoodId,
    generation,
    created_utc: utc(createdUtc, "Estate created_utc"),
    neighborhoods: [{
      schema: NEIGHBORHOOD_SCHEMA,
      kind: "root",
      estate_id: estateId,
      rappid,
      name: safeName,
      adapter: null,
      base_url: null,
      attached_utc: createdUtc,
    }],
  };
  return validateEstate(manifest);
}

export function createResidentNeighborhood({
  estate,
  rappid,
  name,
  baseUrl,
  attachedUtc = new Date().toISOString(),
}) {
  validateEstate(estate);
  const resident = {
    schema: NEIGHBORHOOD_SCHEMA,
    kind: "resident",
    estate_id: estate.estate_id,
    rappid,
    name: text(name, "Neighborhood name", { max: 80 }),
    adapter: "rapp/1",
    base_url: normalizeLoopbackBaseUrl(baseUrl),
    attached_utc: utc(attachedUtc, "Neighborhood attached_utc"),
  };
  return validateNeighborhood(resident, { estateId: estate.estate_id });
}
