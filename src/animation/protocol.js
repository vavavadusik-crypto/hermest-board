export const HERMES_ANIMATION_PROTOCOL_VERSION = "0.1.0";
export const HERMES_ANIMATION_MAX_MESSAGE_BYTES = 1024 * 1024;

export const HERMES_ANIMATION_METHODS = Object.freeze([
  "engine.ping",
  "engine.getCapabilities",
  "engine.getVersion",
  "engine.getDiagnostics",
  "project.create",
  "project.open",
  "project.save",
  "project.close",
  "project.validate",
  "scene.list",
  "scene.create",
  "scene.load",
  "scene.save",
  "scene.serialize",
  "scene.validate",
  "node.list",
  "node.create",
  "node.remove",
  "node.getProperties",
  "node.setProperties",
  "asset.import",
  "asset.list",
  "asset.validate",
  "asset.getMetadata",
  "timeline.get",
  "timeline.seek",
  "timeline.play",
  "timeline.pause",
  "timeline.stop",
  "timeline.setLoop",
  "timeline.addKeyframe",
  "timeline.removeKeyframe",
  "camera.list",
  "camera.setActive",
  "camera.orbit",
  "camera.preview",
  "render.preview",
  "render.start",
  "render.cancel",
  "render.getStatus",
  "render.getResult",
  "test.run",
  "test.getReport"
]);

export const HERMES_ANIMATION_IMPLEMENTED_METHODS = Object.freeze([
  "engine.ping",
  "engine.getCapabilities",
  "engine.getVersion",
  "engine.getDiagnostics"
]);

const METHOD_SET = new Set(HERMES_ANIMATION_METHODS);
const IMPLEMENTED_METHOD_SET = new Set(HERMES_ANIMATION_IMPLEMENTED_METHODS);

export class AnimationProtocolError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = "AnimationProtocolError";
    this.code = code;
    this.data = data;
  }
}

export function parseAnimationMessage(input) {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input ?? "");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes === 0) throw new AnimationProtocolError(-32700, "empty_message");
  if (bytes > HERMES_ANIMATION_MAX_MESSAGE_BYTES) {
    throw new AnimationProtocolError(-32001, "message_too_large", {
      maxBytes: HERMES_ANIMATION_MAX_MESSAGE_BYTES,
      actualBytes: bytes
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AnimationProtocolError(-32700, "parse_error");
  }
}

export function validateAnimationRequest(value, { requireImplemented = false } = {}) {
  if (!isPlainObject(value)) throw new AnimationProtocolError(-32600, "invalid_request");
  if (value.jsonrpc !== "2.0") throw new AnimationProtocolError(-32600, "jsonrpc_must_equal_2_0");
  if (!(typeof value.id === "string" || Number.isSafeInteger(value.id))) {
    throw new AnimationProtocolError(-32600, "request_id_must_be_string_or_integer");
  }
  if (typeof value.method !== "string" || !METHOD_SET.has(value.method)) {
    throw new AnimationProtocolError(-32601, "method_not_found", { method: value.method ?? null });
  }
  if (requireImplemented && !IMPLEMENTED_METHOD_SET.has(value.method)) {
    throw new AnimationProtocolError(-32601, "method_not_implemented", { method: value.method });
  }
  if (value.protocolVersion !== HERMES_ANIMATION_PROTOCOL_VERSION) {
    throw new AnimationProtocolError(-32002, "protocol_version_unsupported", {
      expected: HERMES_ANIMATION_PROTOCOL_VERSION,
      received: value.protocolVersion ?? null
    });
  }
  if (value.params !== undefined && !isPlainObject(value.params) && !Array.isArray(value.params)) {
    throw new AnimationProtocolError(-32602, "params_must_be_object_or_array");
  }
  return Object.freeze({
    jsonrpc: "2.0",
    id: value.id,
    method: value.method,
    params: value.params ?? {},
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
  });
}

export function createAnimationRequest({ id, method, params = {} }) {
  return validateAnimationRequest({
    jsonrpc: "2.0",
    id,
    method,
    params,
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
  });
}

export function createAnimationResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
  };
}

export function createAnimationError(id, error) {
  const normalized = error instanceof AnimationProtocolError
    ? error
    : new AnimationProtocolError(-32603, "internal_error");
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.data === null ? {} : { data: normalized.data })
    },
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
  };
}

export function createEngineCapabilities({
  runtime = "godot",
  runtimeVersion = null,
  transport = "websocket-jsonrpc",
  implementedMethods = HERMES_ANIMATION_IMPLEMENTED_METHODS
} = {}) {
  const implemented = [...new Set(implementedMethods)].filter(method => METHOD_SET.has(method));
  return {
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION,
    runtime,
    runtimeVersion,
    transport,
    methods: HERMES_ANIMATION_METHODS.map(method => ({
      method,
      status: implemented.includes(method) ? "implemented" : "planned"
    }))
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
