import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getConnectorCapabilityStatus,
  planConnectorCapability
} from "../../api/_lib/connector-capabilities.js";
import { buildAgentPlan } from "../../api/_lib/agent-plan.js";

const SECRET = "connector-secret-sentinel-73f2";

function capability(status, id) {
  const result = status.capabilities.find(item => item.id === id);
  assert.ok(result, `Missing capability ${id}`);
  return result;
}

test("capability status is secret-free and never equates configured slots with implemented adapters", () => {
  const env = {
    FAL_KEY: SECRET,
    ELEVENLABS_API_KEY: SECRET,
    YOUTUBE_CLIENT_ID: `client-${SECRET}`,
    YOUTUBE_CLIENT_SECRET: `secret-${SECRET}`,
    OPENAI_API_KEY: SECRET,
    BLOB_READ_WRITE_TOKEN: SECRET
  };
  const status = getConnectorCapabilityStatus({ env, runtime: "server" });
  const serialized = JSON.stringify(status);

  assert.equal(serialized.includes(SECRET), false);
  assert.equal(status.schema, "hermest.connector-capabilities.v1");
  assert.equal(status.runtime, "server");

  const research = capability(status, "research.search");
  assert.equal(research.executable, true);
  assert.equal(research.state, "working_adapter");
  assert.equal(research.primary.adapterId, "public-research-v1");

  const image = capability(status, "image.generate");
  assert.equal(image.executable, false);
  assert.equal(image.state, "configured_but_adapter_missing");
  assert.equal(image.providers.find(provider => provider.id === "fal")?.configured, true);
  assert.ok(image.blockers.includes("adapter_not_implemented"));

  const speech = capability(status, "speech.synthesize");
  assert.equal(speech.executable, false);
  assert.equal(speech.state, "configured_but_adapter_missing");
  assert.equal(speech.providers.find(provider => provider.id === "elevenlabs")?.configured, true);

  const publish = capability(status, "publish.draft");
  assert.equal(publish.executable, false);
  assert.equal(publish.state, "approval_required");
  assert.equal(publish.approvalRequired, true);
  assert.ok(publish.blockers.includes("oauth_token_exchange_not_implemented"));
  assert.ok(publish.blockers.includes("immutable_publish_candidate_required"));
  assert.equal(publish.providers.find(provider => provider.id === "youtube")?.state, "oauth_skeleton");
});

test("local Flite is selected only for the local media runtime", () => {
  const local = planConnectorCapability("speech.synthesize", {
    env: {},
    runtime: "local_media"
  });
  assert.equal(local.executable, true);
  assert.equal(local.state, "working_adapter");
  assert.equal(local.primary.adapterId, "local-flite-v1");

  const server = planConnectorCapability("speech.synthesize", {
    env: {},
    runtime: "server"
  });
  assert.equal(server.executable, false);
  assert.equal(server.primary.adapterId, "elevenlabs-tts-v1");
  assert.ok(server.blockers.includes("adapter_not_implemented"));
});

test("agent plan consumes capability routes without enabling publishing or leaking env values", () => {
  const env = {
    FAL_KEY: SECRET,
    YOUTUBE_CLIENT_ID: `client-${SECRET}`,
    YOUTUBE_CLIENT_SECRET: `secret-${SECRET}`,
    DATABASE_URL: `postgres://user:${SECRET}@localhost/db`
  };
  const plan = buildAgentPlan({
    platforms: ["youtube_video"],
    tools: ["parser", "generated_media"],
    languages: ["ru"]
  }, { env, runtime: "server" });
  const serialized = JSON.stringify(plan);

  assert.equal(serialized.includes(SECRET), false);
  assert.equal(plan.canAutopublish, false);
  assert.ok(Array.isArray(plan.connectorRoutes));
  assert.equal(plan.connectorRoutes.find(route => route.id === "research.search")?.executable, true);
  assert.equal(plan.connectorRoutes.find(route => route.id === "image.generate")?.executable, false);
  assert.equal(plan.connectorRoutes.find(route => route.id === "publish.draft")?.executable, false);
  assert.ok(plan.blockers.includes("image_generate_adapter_not_implemented"));
  assert.ok(plan.blockers.includes("youtube_oauth_token_exchange_not_implemented"));
  assert.equal(plan.steps.find(step => step.id === "publish_drafts")?.status, "blocked");
});

test("Board agent formatter reads explicit connector state instead of object truthiness", async () => {
  const source = await readFile(new URL("../../src/app.js", import.meta.url), "utf8");
  assert.match(source, /Boolean\(value\?\.configured\)/);
  assert.doesNotMatch(source, /\$\{value \? "configured" : "missing"\}/);
});

test("design capabilities keep platform approval gates as named blockers", () => {
  const env = {
    FIGMA_ACCESS_TOKEN: SECRET,
    CANVA_CLIENT_ID: `client-${SECRET}`,
    CANVA_CLIENT_SECRET: `secret-${SECRET}`,
    ADOBE_FIREFLY_CLIENT_ID: `client-${SECRET}`,
    ADOBE_FIREFLY_CLIENT_SECRET: `secret-${SECRET}`
  };
  const status = getConnectorCapabilityStatus({ env, runtime: "server" });
  assert.equal(JSON.stringify(status).includes(SECRET), false);

  // The Figma route is implemented, so a configured token really does make it
  // executable; the Canva and Drive routes on the same capability stay blocked and
  // keep their platform gates listed.
  const designImport = capability(status, "design.import");
  assert.equal(designImport.executable, true);
  assert.equal(designImport.state, "configured_adapter");
  assert.equal(designImport.primary.adapterId, "figma-file-import-v1");
  assert.equal(designImport.providers.find(provider => provider.id === "figma")?.configured, true);
  assert.ok(designImport.blockers.includes("adapter_not_implemented"));
  assert.ok(designImport.blockers.includes("canva_integration_review_required"));
  assert.ok(designImport.blockers.includes("google_oauth_app_verification_required"));

  const brandAssets = capability(status, "brand.assets");
  assert.equal(brandAssets.executable, true);
  assert.equal(brandAssets.primary.adapterId, "figma-brand-assets-v1");
  assert.ok(brandAssets.blockers.includes("canva_brand_template_plan_required"));
  assert.ok(brandAssets.blockers.includes("adobe_developer_console_project_required"));

  const designExport = capability(status, "design.export");
  assert.equal(designExport.executable, false);
  assert.equal(designExport.state, "oauth_skeleton");
  assert.ok(designExport.blockers.includes("oauth_token_exchange_not_implemented"));
  assert.ok(designExport.blockers.includes("canva_integration_review_required"));

  const image = capability(status, "image.generate");
  const firefly = image.fallbacks.concat(image.primary).find(route => route?.adapterId === "adobe-firefly-image-v1");
  assert.ok(firefly, "Missing Firefly route");
  assert.equal(firefly.executable, false);
  assert.ok(firefly.blockers.includes("adobe_firefly_entitlement_required"));
});

test("design connectors stay blocked when no design credential is configured", () => {
  const plan = planConnectorCapability("design.import", { env: {}, runtime: "server" });
  assert.equal(plan.executable, false);
  assert.equal(plan.providers.find(provider => provider.id === "figma")?.configured, false);
  assert.equal(plan.providers.find(provider => provider.id === "figma")?.state, "blocked");
  assert.ok(plan.blockers.includes("provider_credentials_missing"));

  const brandAssets = planConnectorCapability("brand.assets", { env: {}, runtime: "server" });
  assert.equal(brandAssets.executable, false);
  assert.ok(brandAssets.blockers.includes("provider_credentials_missing"));
});

test("unknown capabilities fail closed", () => {
  assert.throws(
    () => planConnectorCapability("shell.execute", { env: {}, runtime: "server" }),
    /unknown_connector_capability/
  );
});
