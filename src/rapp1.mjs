import { createHash, randomUUID } from "node:crypto";

export const RAPP_SPEC = "rapp/1";
export const RAPP1_SPEC_SHA256 =
  "cea7847f98f9751734995f46fd4e1bde211c8eb9d03dbbb477934213865bb91a";
export const RAPP1_SPEC_BYTES = 41_952;

const OWNER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH = /^[0-9a-f]{64}$/;
const STEP = new Set(["1", "1a", "2", "3", "4", "5", "6"]);
const MAX_CANONICAL_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;

function assertString(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  assertNoLoneSurrogates(value, label);
  return value;
}

function assertNewNfcString(value, label) {
  assertString(value, label);
  if (value !== value.normalize("NFC")) {
    throw new Error(`${label} must be emitted in Unicode NFC.`);
  }
  return value;
}

function assertNoLoneSurrogates(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${label} contains an unpaired UTF-16 surrogate.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${label} contains an unpaired UTF-16 surrogate.`);
    }
  }
}

function normalizedDecimal(source) {
  let token = source.toLowerCase();
  let sign = "";
  if (token.startsWith("-")) {
    sign = "-";
    token = token.slice(1);
  }
  const [coefficient, exponentText = "0"] = token.split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const exponentSign = exponentText.startsWith("-") ? -1 : 1;
  const exponentDigits = exponentText
    .replace(/^[+-]/, "")
    .replace(/^0+/, "") || "0";
  if (exponentDigits.length > 4) {
    throw new Error("JSON number exponent is outside the binary64 domain.");
  }
  let exponent = exponentSign * Number(exponentDigits) - fraction.length;
  let digits = `${whole}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const trailing = /0+$/.exec(digits)?.[0].length || 0;
  if (trailing) {
    digits = digits.slice(0, -trailing);
    exponent += trailing;
  }
  return `${sign}${digits}e${exponent}`;
}

function mathematicallyEqual(left, right) {
  return normalizedDecimal(left) === normalizedDecimal(right);
}

class IJsonParser {
  constructor(source) {
    this.source = assertString(source, "JSON input");
    if (Buffer.byteLength(this.source, "utf8") > MAX_CANONICAL_BYTES) {
      throw new Error(`JSON input exceeds ${MAX_CANONICAL_BYTES} bytes.`);
    }
    this.offset = 0;
  }

  parse() {
    this.#space();
    const value = this.#value(1);
    this.#space();
    if (this.offset !== this.source.length) {
      throw new Error("JSON input has trailing data.");
    }
    canonical(value);
    return value;
  }

  #space() {
    while (/[\u0009\u000a\u000d\u0020]/.test(this.source[this.offset] || "")) {
      this.offset += 1;
    }
  }

  #value(depth) {
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`JSON nesting exceeds ${MAX_JSON_DEPTH}.`);
    }
    this.#space();
    const token = this.source[this.offset];
    if (token === "{") return this.#object(depth);
    if (token === "[") return this.#array(depth);
    if (token === "\"") return this.#string();
    if (token === "t") return this.#literal("true", true);
    if (token === "f") return this.#literal("false", false);
    if (token === "n") return this.#literal("null", null);
    if (token === "-" || /[0-9]/.test(token || "")) return this.#number();
    throw new Error(`Invalid JSON token at byte ${this.offset}.`);
  }

  #literal(source, value) {
    if (this.source.slice(this.offset, this.offset + source.length) !== source) {
      throw new Error(`Invalid JSON token at byte ${this.offset}.`);
    }
    this.offset += source.length;
    return value;
  }

  #string() {
    const start = this.offset;
    this.offset += 1;
    let escaped = false;
    while (this.offset < this.source.length) {
      const code = this.source.charCodeAt(this.offset);
      if (!escaped && code === 0x22) {
        this.offset += 1;
        const value = JSON.parse(this.source.slice(start, this.offset));
        assertNoLoneSurrogates(value, "JSON string");
        return value;
      }
      if (!escaped && code < 0x20) {
        throw new Error("JSON strings cannot contain unescaped control characters.");
      }
      if (!escaped && code === 0x5c) {
        escaped = true;
      } else {
        escaped = false;
      }
      this.offset += 1;
    }
    throw new Error("Unterminated JSON string.");
  }

  #number() {
    const remaining = this.source.slice(this.offset);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      remaining,
    );
    if (!match) throw new Error(`Invalid JSON number at byte ${this.offset}.`);
    const token = match[0];
    const value = Number(token);
    if (
      !Number.isFinite(value)
      || !mathematicallyEqual(token, JSON.stringify(value))
    ) {
      throw new Error(`JSON number ${token} does not survive the binary64 round-trip.`);
    }
    this.offset += token.length;
    return value;
  }

  #array(depth) {
    const result = [];
    this.offset += 1;
    this.#space();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return result;
    }
    while (true) {
      result.push(this.#value(depth + 1));
      this.#space();
      if (this.source[this.offset] === "]") {
        this.offset += 1;
        return result;
      }
      if (this.source[this.offset] !== ",") {
        throw new Error(`Expected ',' or ']' at byte ${this.offset}.`);
      }
      this.offset += 1;
    }
  }

  #object(depth) {
    const result = {};
    const names = new Set();
    this.offset += 1;
    this.#space();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return result;
    }
    while (true) {
      this.#space();
      if (this.source[this.offset] !== "\"") {
        throw new Error(`Expected an object member name at byte ${this.offset}.`);
      }
      const name = this.#string();
      if (names.has(name)) {
        throw new Error(`JSON object contains duplicate member ${JSON.stringify(name)}.`);
      }
      names.add(name);
      this.#space();
      if (this.source[this.offset] !== ":") {
        throw new Error(`Expected ':' at byte ${this.offset}.`);
      }
      this.offset += 1;
      Object.defineProperty(result, name, {
        configurable: true,
        enumerable: true,
        value: this.#value(depth + 1),
        writable: true,
      });
      this.#space();
      if (this.source[this.offset] === "}") {
        this.offset += 1;
        return result;
      }
      if (this.source[this.offset] !== ",") {
        throw new Error(`Expected ',' or '}' at byte ${this.offset}.`);
      }
      this.offset += 1;
    }
  }
}

export function parseIJson(source) {
  return new IJsonParser(source).parse();
}

function canonicalValue(value, depth = 1) {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(`JSON nesting exceeds ${MAX_JSON_DEPTH}.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertNoLoneSurrogates(value, "JSON string");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("I-JSON numbers must be finite.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry, depth + 1));
  }
  if (
    typeof value !== "object"
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error("RAPP canonicalization accepts only I-JSON values.");
  }
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    assertNoLoneSurrogates(key, "JSON member name");
    result[key] = canonicalValue(value[key], depth + 1);
  }
  return result;
}

export function canonical(value) {
  const encoded = JSON.stringify(canonicalValue(value));
  if (Buffer.byteLength(encoded, "utf8") > MAX_CANONICAL_BYTES) {
    throw new Error(`Canonical JSON exceeds ${MAX_CANONICAL_BYTES} bytes.`);
  }
  return encoded;
}

export function Hb(space, bytes) {
  assertString(space, "Hash space");
  if (space.includes("\n") || !/^[\x20-\x7e]+$/.test(space)) {
    throw new Error("Hash space must be an exact printable ASCII tag without LF.");
  }
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha256")
    .update(space, "utf8")
    .update("\n", "utf8")
    .update(body)
    .digest("hex");
}

export function H(space, value) {
  return Hb(space, Buffer.from(canonical(value), "utf8"));
}

export function validateRappid(value) {
  if (typeof value !== "string") return false;
  const match = /^rappid:@([^/]+)\/([^:]+):([0-9a-f]{64})$/.exec(value);
  if (!match) return false;
  const [, owner, slug, tail] = match;
  return owner.length <= 39
    && slug.length <= 100
    && OWNER.test(owner)
    && OWNER.test(slug)
    && HASH.test(tail);
}

export function uuidV4Octets(value) {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i
    .exec(String(value));
  if (!match) throw new Error("Identity mint requires an RFC 9562 UUID string.");
  const bytes = Buffer.from(match.slice(1).join(""), "hex");
  if ((bytes[6] & 0xf0) !== 0x40 || (bytes[8] & 0xc0) !== 0x80) {
    throw new Error("Keyless identity mint requires UUIDv4 octets.");
  }
  return bytes;
}

export function mintRappid(owner, slug, { uuid = randomUUID() } = {}) {
  assertNewNfcString(owner, "RAPP owner");
  assertNewNfcString(slug, "RAPP slug");
  if (
    owner.length > 39
    || slug.length > 100
    || !OWNER.test(owner)
    || !OWNER.test(slug)
  ) {
    throw new Error("RAPP owner or slug violates the exact section 6.1 grammar.");
  }
  const tail = Hb("rapp/1:rappid", uuidV4Octets(uuid));
  return `rappid:@${owner}/${slug}:${tail}`;
}

function exactObject(value, keys, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a JSON object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has nonconforming members.`);
  }
  return value;
}

export function buildChatRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("RAPP chat request input must be an object.");
  }
  const allowed = new Set(["user_input", "session_id", "idempotency_key"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new Error(`RAPP chat producer refuses unrecognized member ${key}.`);
    }
  }
  const request = {
    user_input: assertString(input.user_input, "user_input"),
  };
  for (const optional of ["session_id", "idempotency_key"]) {
    if (input[optional] !== undefined) {
      request[optional] = assertString(input[optional], optional);
    }
  }
  canonical(request);
  return request;
}

export class RappChatRefusal extends Error {
  constructor(code, step) {
    super(`RAPP chat refused: ${code}${step === null ? "" : ` at step ${step}`}`);
    this.name = "RappChatRefusal";
    this.code = code;
    this.step = step;
  }
}

export function parseChatEnvelope(status, source, {
  registeredErrorCodes = new Set(["unknown-session"]),
} = {}) {
  const value = parseIJson(source);
  if (status === 200) {
    exactObject(value, ["response", "agent_logs", "session_id"], "RAPP chat success");
    assertString(value.response, "response");
    assertString(value.session_id, "session_id");
    if (
      !Array.isArray(value.agent_logs)
      || value.agent_logs.some((entry) => typeof entry !== "string")
    ) {
      throw new Error("agent_logs must be an array of strings.");
    }
    return value;
  }
  if (status === 422) {
    exactObject(value, ["error"], "RAPP chat refusal");
    exactObject(value.error, ["code", "step"], "RAPP chat refusal error");
    const code = assertString(value.error.code, "error.code");
    const step = value.error.step;
    if (step !== null && (!STEP.has(step) || typeof step !== "string")) {
      throw new Error("RAPP chat refusal carries an invalid verification step.");
    }
    if (!registeredErrorCodes.has(code)) {
      throw new Error(`RAPP chat refusal code ${code} is not in the accepted registry view.`);
    }
    throw new RappChatRefusal(code, step);
  }
  throw new Error(`RAPP chat returned nonconforming HTTP status ${status}.`);
}
