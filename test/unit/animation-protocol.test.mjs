import assert from "node:assert/strict";
import test from "node:test";

import {
  AnimationProtocolError,
  HERMES_ANIMATION_IMPLEMENTED_METHODS,
  HERMES_ANIMATION_MAX_MESSAGE_BYTES,
  HERMES_ANIMATION_PROTOCOL_VERSION,
  createAnimationError,
  createAnimationRequest,
  createAnimationResult,
  createEngineCapabilities,
  parseAnimationMessage,
  validateAnimationRequest
} from "../../src/animation/protocol.js";

test("animation request round-trips through the versioned JSON-RPC contract", () => {
  const request = createAnimationRequest({ id: "ping-1", method: "engine.ping", params: { nonce: "abc" } });
  assert.deepEqual(request, {
    jsonrpc: "2.0",
    id: "ping-1",
    method: "engine.ping",
    params: { nonce: "abc" },
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
  });
  assert.deepEqual(validateAnimationRequest(parseAnimationMessage(JSON.stringify(request))), request);
});

test("protocol rejects unknown versions and unknown methods with structured errors", () => {
  assert.throws(
    () => validateAnimationRequest({ jsonrpc: "2.0", id: 1, method: "engine.ping", protocolVersion: "9.9.9" }),
    error => error instanceof AnimationProtocolError && error.code === -32002
  );
  assert.throws(
    () => validateAnimationRequest({ jsonrpc: "2.0", id: 1, method: "engine.destroyEverything", protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION }),
    error => error instanceof AnimationProtocolError && error.code === -32601
  );
});

test("runtime gate distinguishes the contract from milestone-one implementation", () => {
  assert.throws(
    () => validateAnimationRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "scene.load",
      params: {},
      protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
    }, { requireImplemented: true }),
    error => error instanceof AnimationProtocolError && error.message === "method_not_implemented"
  );
  assert.doesNotThrow(() => validateAnimationRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "engine.getCapabilities",
    params: {},
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
  }, { requireImplemented: true }));
});

test("parser fails closed for empty, malformed, and oversized messages", () => {
  assert.throws(() => parseAnimationMessage(""), /empty_message/);
  assert.throws(() => parseAnimationMessage("{"), /parse_error/);
  assert.throws(
    () => parseAnimationMessage(`"${"x".repeat(HERMES_ANIMATION_MAX_MESSAGE_BYTES)}"`),
    error => error instanceof AnimationProtocolError && error.code === -32001
  );
});

test("results, errors, and capability inventory carry the protocol version", () => {
  assert.deepEqual(createAnimationResult("a", { ok: true }), {
    jsonrpc: "2.0",
    id: "a",
    result: { ok: true },
    protocolVersion: HERMES_ANIMATION_PROTOCOL_VERSION
  });
  const errorPayload = createAnimationError("b", new AnimationProtocolError(-32602, "bad_params", { field: "port" }));
  assert.equal(errorPayload.error.code, -32602);
  assert.deepEqual(errorPayload.error.data, { field: "port" });

  const capabilities = createEngineCapabilities({ runtimeVersion: "4.x" });
  assert.equal(capabilities.protocolVersion, HERMES_ANIMATION_PROTOCOL_VERSION);
  assert.deepEqual(
    capabilities.methods.filter(entry => entry.status === "implemented").map(entry => entry.method),
    HERMES_ANIMATION_IMPLEMENTED_METHODS
  );
});
