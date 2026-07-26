import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import connectorCallback from "../api/connectors/callback.js";
import connectorStart from "../api/connectors/start.js";
import connectorStatus from "../api/connectors/status.js";
import aiRespond from "../api/ai/respond.js";
import product from "../api/product.js";
import userConfigSchema from "../api/user-config/schema.js";
import { createSignedSessionToken } from "../api/_lib/session.js";
import { buildPublishCandidate } from "../api/_lib/publish-candidates.js";
import { getRecord, saveRecord } from "../api/_lib/storage.js";
import { decryptSecret } from "../api/_lib/token-vault.js";

const originalEnv = { ...process.env };
const dataDir = mkdtempSync(join(tmpdir(), "hermest-api-smoke-"));

try {
  process.env.HERMEST_DATA_DIR = dataDir;
  delete process.env.VERCEL;
  delete process.env.HERMEST_ENABLE_DEMO_STORAGE;
  delete process.env.HERMEST_OWNER_TOKEN;
  delete process.env.HERMEST_ACCOUNT_AUTH;
  delete process.env.HERMEST_SESSION_SECRET;
  delete process.env.HERMEST_OAUTH_STATE_SECRET;
  delete process.env.HERMEST_TOKEN_ENCRYPTION_KEY;

  const storageStatus = await expect("storage", "GET", "storage/status", null, 200);
  if (storageStatus.adapter !== "json-file" || storageStatus.adapterInterfaceVersion !== 1) {
    throw new Error(`Expected json-file storage adapter contract, got ${JSON.stringify(storageStatus)}`);
  }
  const preflight = await expect("preflight", "GET", "preflight", null, 200);
  if (preflight.launchReady !== false || preflight.canAutopublish !== false) {
    throw new Error(`Expected blocked alpha preflight, got ${JSON.stringify(preflight)}`);
  }
  if (preflight.storage.adapterInterfaceImplemented !== true || preflight.storage.durableAdapterImplemented !== true || preflight.storage.durableAdapterConfigured !== false) {
    throw new Error(`Expected adapter boundary with disabled durable adapter, got ${JSON.stringify(preflight.storage)}`);
  }
  if (!preflight.blockers.includes("account_auth_not_enabled")) {
    throw new Error(`Expected real auth blocker, got ${JSON.stringify(preflight.blockers)}`);
  }
  const agentPlan = await expect("agent-plan", "POST", "agent/plan", {
    platforms: ["youtube_video"],
    tools: ["parser", "translator"],
    languages: ["ru", "en"]
  }, 200);
  if (agentPlan.canAutopublish !== false || agentPlan.steps.find(step => step.id === "publish_drafts")?.status !== "blocked") {
    throw new Error(`Expected capability-routed blocked publish plan, got ${JSON.stringify(agentPlan)}`);
  }
  process.env.FAL_KEY = "smoke-capability-secret-sentinel";
  const capabilityStatus = await expect("connector-capabilities", "GET", "connectors/capabilities", null, 200);
  const imageCapability = capabilityStatus.capabilities?.find(capability => capability.id === "image.generate");
  if (imageCapability?.state !== "configured_but_adapter_missing" || imageCapability.executable !== false) {
    throw new Error(`Expected configured but unimplemented image adapter, got ${JSON.stringify(imageCapability)}`);
  }
  if (JSON.stringify(capabilityStatus).includes(process.env.FAL_KEY)) {
    throw new Error("Connector capability status leaked a configured secret value.");
  }
  delete process.env.FAL_KEY;
  const missingAiKey = await expectAi("ai-respond-missing-key", "POST", {
    prompt: "hello"
  }, 401);
  if (missingAiKey.error !== "api_key_required") {
    throw new Error(`Expected api_key_required, got ${missingAiKey.error}`);
  }
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options = {}) => {
      if (url === "https://api.openai.com/v1/responses") {
        if (options.headers?.authorization !== "Bearer smoke-user-openai-key") {
          throw new Error("Expected user-owned OpenAI key to be forwarded only in Authorization header.");
        }
        if (String(options.body || "").includes("smoke-user-openai-key")) {
          throw new Error("AI request body must not contain the OpenAI API key.");
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              id: "resp_smoke",
              output_text: "AI smoke ok",
              usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 }
            });
          }
        };
      }
      if (url === "https://api.groq.com/openai/v1/chat/completions") {
        if (options.headers?.authorization !== "Bearer smoke-user-groq-key") {
          throw new Error("Expected user-owned Groq key to be forwarded only in Authorization header.");
        }
        if (String(options.body || "").includes("smoke-user-groq-key")) {
          throw new Error("AI request body must not contain the Groq API key.");
        }
        const request = JSON.parse(String(options.body || "{}"));
        if (!Array.isArray(request.messages) || request.max_tokens !== 1400) {
          throw new Error(`Expected chat completions payload, got ${JSON.stringify(request)}`);
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              id: "chatcmpl_smoke",
              choices: [{ message: { content: "Groq smoke ok" } }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
            });
          }
        };
      }
      throw new Error(`Unexpected AI provider URL: ${url}`);
    };
    const aiResponse = await expectAi("ai-respond-openai-mock", "POST", {
      prompt: "Check Hermest Board AI settings.",
      context: "Board title: API smoke",
      model: "gpt-4.1-mini"
    }, 200, { authorization: "Bearer smoke-user-openai-key" });
    if (aiResponse.text !== "AI smoke ok" || aiResponse.provider !== "openai") {
      throw new Error(`Expected mocked AI response, got ${JSON.stringify(aiResponse)}`);
    }
    const groqResponse = await expectAi("ai-respond-groq-mock", "POST", {
      provider: "groq",
      prompt: "Check Hermest Board Groq settings.",
      context: "Board title: API smoke",
      model: "llama-3.3-70b-versatile",
      maxOutputTokens: 1400
    }, 200, { authorization: "Bearer smoke-user-groq-key" });
    if (groqResponse.text !== "Groq smoke ok" || groqResponse.provider !== "groq") {
      throw new Error(`Expected mocked Groq response, got ${JSON.stringify(groqResponse)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  const connectorStatusPayload = await expectConnector("connector-status", connectorStatus, "GET", {});
  if (connectorStatusPayload.oauth.stateSigningImplemented !== true || connectorStatusPayload.oauth.stateSecretConfigured !== false) {
    throw new Error(`Expected connector state signing status, got ${JSON.stringify(connectorStatusPayload.oauth)}`);
  }
  const userConfig = await expectConnector("user-config-schema", userConfigSchema, "GET", {});
  const openAiUserKey = userConfig.userVisibleFields?.find(field => field.key === "openaiApiKey");
  const noKeyProviders = (userConfig.apiProviderCatalog || []).filter(provider => provider.auth === "none");
  if (!openAiUserKey?.secret || !openAiUserKey?.browserOnly || !userConfig.hiddenServerSideSecrets?.includes("OPENAI_API_KEY") || noKeyProviders.length < 3) {
    throw new Error(`Expected user BYOK schema to stay separate from owner secrets, got ${JSON.stringify(userConfig)}`);
  }
  const connectorMissingConfig = await expectConnector("connector-start-missing-config", connectorStart, "GET", { provider: "youtube" }, null, 501);
  if (connectorMissingConfig.error !== "connector_not_configured") {
    throw new Error(`Expected connector_not_configured, got ${connectorMissingConfig.error}`);
  }
  process.env.YOUTUBE_CLIENT_ID = "smoke-youtube-client";
  process.env.YOUTUBE_REDIRECT_URI = "https://example.com/api/connectors/callback?provider=youtube";
  const connectorMissingStateSecret = await expectConnector("connector-start-missing-state-secret", connectorStart, "GET", { provider: "youtube" }, null, 501);
  if (connectorMissingStateSecret.error !== "oauth_state_secret_not_configured") {
    throw new Error(`Expected oauth_state_secret_not_configured, got ${connectorMissingStateSecret.error}`);
  }
  process.env.HERMEST_OAUTH_STATE_SECRET = "oauth-state-secret-for-smoke";
  const connectorStartPayload = await expectConnector("connector-start-signed-state", connectorStart, "GET", {
    provider: "youtube",
    workspaceId: "workspace_oauth_smoke"
  });
  if (!String(connectorStartPayload.state || "").startsWith("hermest.oauth.v1.") || !connectorStartPayload.authUrl.includes(encodeURIComponent(connectorStartPayload.state))) {
    throw new Error(`Expected signed OAuth state in auth URL, got ${JSON.stringify(connectorStartPayload)}`);
  }
  const invalidCallback = await expectConnector("connector-callback-invalid-state", connectorCallback, "GET", {
    provider: "youtube",
    state: "bad-state",
    code: "code"
  }, null, 400);
  if (invalidCallback.error !== "invalid_oauth_state") {
    throw new Error(`Expected invalid_oauth_state, got ${invalidCallback.error}`);
  }
  const missingCodeCallback = await expectConnector("connector-callback-missing-code", connectorCallback, "GET", {
    provider: "youtube",
    state: connectorStartPayload.state
  }, null, 400);
  if (missingCodeCallback.error !== "oauth_code_missing" || missingCodeCallback.stateValid !== true) {
    throw new Error(`Expected valid state with missing code error, got ${JSON.stringify(missingCodeCallback)}`);
  }
  const blockedCallback = await expectConnector("connector-callback-token-exchange-blocked", connectorCallback, "GET", {
    provider: "youtube",
    state: connectorStartPayload.state,
    code: "provider-code"
  }, null, 501);
  if (blockedCallback.error !== "oauth_token_exchange_not_implemented" || blockedCallback.stateValid !== true) {
    throw new Error(`Expected token exchange blocker after state validation, got ${JSON.stringify(blockedCallback)}`);
  }
  delete process.env.HERMEST_OAUTH_STATE_SECRET;
  delete process.env.YOUTUBE_CLIENT_ID;
  delete process.env.YOUTUBE_REDIRECT_URI;
  const localSession = await expect("session-current-local", "GET", "session/current", null, 200);
  if (localSession.actor.id !== "local-dev" || localSession.session.realUserAuthImplemented !== true || localSession.session.realUserAuthEnabled !== false || localSession.session.signedSessionIssuerImplemented !== true) {
    throw new Error(`Expected local bootstrap session, got ${JSON.stringify(localSession)}`);
  }

  process.env.HERMEST_OWNER_TOKEN = "session-bootstrap-owner-token";
  const missingSessionSecret = await expect("session-bootstrap-missing-secret", "POST", "session/bootstrap", {
    sub: "user_bootstrap_smoke",
    workspaceId: "workspace_bootstrap_smoke"
  }, 501, { authorization: "Bearer session-bootstrap-owner-token" });
  if (missingSessionSecret.error !== "session_secret_not_configured") {
    throw new Error(`Expected session_secret_not_configured, got ${missingSessionSecret.error}`);
  }

  process.env.HERMEST_SESSION_SECRET = "local-session-secret-for-smoke";
  const unauthorizedBootstrap = await expect("session-bootstrap-unauthorized", "POST", "session/bootstrap", {
    sub: "user_bootstrap_smoke",
    workspaceId: "workspace_bootstrap_smoke"
  }, 401);
  if (unauthorizedBootstrap.error !== "unauthorized") {
    throw new Error(`Expected unauthorized bootstrap issuer, got ${unauthorizedBootstrap.error}`);
  }
  const bootstrap = await expect("session-bootstrap-owner-token", "POST", "session/bootstrap", {
    sub: "user_bootstrap_smoke",
    workspaceId: "workspace_bootstrap_smoke",
    ttlSeconds: 120
  }, 201, { authorization: "Bearer session-bootstrap-owner-token" });
  if (!String(bootstrap.token || "").startsWith("hermest.v1.") || bootstrap.actor.workspaceId !== "workspace_bootstrap_smoke") {
    throw new Error(`Expected bootstrap signed session token, got ${JSON.stringify(bootstrap)}`);
  }
  const bootstrapSession = await expect("session-current-bootstrap-token", "GET", "session/current", null, 200, { authorization: `Bearer ${bootstrap.token}` });
  if (bootstrapSession.actor.id !== "user_bootstrap_smoke" || bootstrapSession.actor.workspaceId !== "workspace_bootstrap_smoke") {
    throw new Error(`Expected bootstrap token to authenticate, got ${JSON.stringify(bootstrapSession)}`);
  }
  delete process.env.HERMEST_OWNER_TOKEN;

  const signedToken = createSignedSessionToken({
    sub: "user_smoke",
    workspaceId: "workspace_smoke"
  });
  const signedSession = await expect("session-current-signed", "GET", "session/current", null, 200, { authorization: `Bearer ${signedToken}` });
  if (signedSession.actor.id !== "user_smoke" || signedSession.actor.workspaceId !== "workspace_smoke") {
    throw new Error(`Expected signed-session actor, got ${JSON.stringify(signedSession)}`);
  }
  process.env.HERMEST_ACCOUNT_AUTH = "1";
  const accountAuthStatus = await expect("account-auth-status", "GET", "auth/status", null, 200);
  if (accountAuthStatus.accountAuth.ready !== true || accountAuthStatus.accountAuth.passwordHashing !== "scrypt") {
    throw new Error(`Expected ready account auth status, got ${JSON.stringify(accountAuthStatus.accountAuth)}`);
  }
  const accountSignup = await expect("account-signup", "POST", "auth/signup", {
    email: "smoke@example.com",
    displayName: "Smoke User",
    password: "smoke password value"
  }, 201);
  if (!accountSignup.account?.id?.startsWith("usr_") || accountSignup.account.passwordHash || accountSignup.tokenReturned !== false) {
    throw new Error(`Expected redacted account signup, got ${JSON.stringify(accountSignup)}`);
  }
  if (JSON.stringify(accountSignup).includes("smoke password value")) {
    throw new Error("Account signup response leaked the password.");
  }
  const signupCookie = accountSignup._headers?.["Set-Cookie"] || "";
  if (!signupCookie.includes("hermest_session=") || !signupCookie.includes("HttpOnly")) {
    throw new Error(`Expected httpOnly signup cookie, got ${signupCookie}`);
  }
  const accountSession = await expect("account-session-current", "GET", "session/current", null, 200, { cookie: signupCookie });
  if (accountSession.actor.id !== accountSignup.account.id || accountSession.actor.workspaceId !== accountSignup.account.workspaceId) {
    throw new Error(`Expected signup cookie to authenticate, got ${JSON.stringify(accountSession)}`);
  }
  const accountProject = await expect("account-project-create", "POST", "projects", {
    project: { title: "account project", cards: [] }
  }, 201, { cookie: signupCookie });
  if (accountProject.project.ownerUserId !== accountSignup.account.id || accountProject.project.workspaceId !== accountSignup.account.workspaceId) {
    throw new Error(`Expected account project ownership, got ${JSON.stringify(accountProject.project)}`);
  }
  const duplicateSignup = await expect("account-signup-duplicate", "POST", "auth/signup", {
    email: "smoke@example.com",
    password: "smoke password value"
  }, 409);
  if (duplicateSignup.error !== "account_email_already_exists") {
    throw new Error(`Expected duplicate account email error, got ${duplicateSignup.error}`);
  }
  const badLogin = await expect("account-login-bad-password", "POST", "auth/login", {
    email: "smoke@example.com",
    password: "wrong password"
  }, 401);
  if (badLogin.error !== "invalid_account_credentials") {
    throw new Error(`Expected invalid credentials, got ${badLogin.error}`);
  }
  const accountLogin = await expect("account-login", "POST", "auth/login", {
    email: "SMOKE@example.com",
    password: "smoke password value"
  }, 200);
  if (accountLogin.account.id !== accountSignup.account.id || !String(accountLogin._headers?.["Set-Cookie"] || "").includes("HttpOnly")) {
    throw new Error(`Expected account login cookie, got ${JSON.stringify(accountLogin)}`);
  }
  const accountLogout = await expect("account-logout", "POST", "auth/logout", null, 200, { cookie: accountLogin._headers["Set-Cookie"] });
  if (!String(accountLogout._headers?.["Set-Cookie"] || "").includes("Max-Age=0")) {
    throw new Error(`Expected logout to clear cookie, got ${accountLogout._headers?.["Set-Cookie"]}`);
  }
  await expect("account-project-delete", "DELETE", `projects/${accountProject.project.id}`, null, 200, { cookie: signupCookie });
  delete process.env.HERMEST_ACCOUNT_AUTH;
  const signedProject = await expect("project-create-signed-session", "POST", "projects", {
    project: { title: "signed session project", cards: [] }
  }, 201, { authorization: `Bearer ${signedToken}` });
  if (signedProject.project.workspaceId !== "workspace_smoke" || signedProject.project.ownerUserId !== "user_smoke") {
    throw new Error(`Expected signed-session ownership metadata, got ${JSON.stringify(signedProject.project)}`);
  }
  const otherToken = createSignedSessionToken({
    sub: "user_other",
    workspaceId: "workspace_other"
  });
  const signedList = await expect("project-list-signed-session", "GET", "projects", null, 200, { authorization: `Bearer ${signedToken}` });
  if (!signedList.projects.some(project => project.id === signedProject.project.id)) {
    throw new Error(`Expected signed project in signed-session list, got ${JSON.stringify(signedList.projects)}`);
  }
  const otherList = await expect("project-list-other-session", "GET", "projects", null, 200, { authorization: `Bearer ${otherToken}` });
  if (otherList.projects.some(project => project.id === signedProject.project.id)) {
    throw new Error(`Expected other workspace list to exclude signed project, got ${JSON.stringify(otherList.projects)}`);
  }
  const forbiddenSignedRead = await expect("project-read-other-session", "GET", `projects/${signedProject.project.id}`, null, 403, { authorization: `Bearer ${otherToken}` });
  if (forbiddenSignedRead.error !== "forbidden") {
    throw new Error(`Expected forbidden signed-session project read, got ${forbiddenSignedRead.error}`);
  }
  const missingTokenKey = await expect("connector-create-missing-token-key", "POST", "connectors", {
    provider: "youtube",
    accountLabel: "Smoke YouTube",
    accessToken: "access-smoke-secret"
  }, 501, { authorization: `Bearer ${signedToken}` });
  if (missingTokenKey.error !== "token_encryption_key_not_configured") {
    throw new Error(`Expected token_encryption_key_not_configured, got ${missingTokenKey.error}`);
  }
  process.env.HERMEST_TOKEN_ENCRYPTION_KEY = "token-encryption-secret-for-smoke-tests";
  const signedConnector = await expect("connector-create-signed-session", "POST", "connectors", {
    provider: "youtube",
    accountLabel: "Smoke YouTube",
    scopes: ["youtube.upload"],
    accessToken: "access-smoke-secret",
    refreshToken: "refresh-smoke-secret",
    tokenExpiresAt: "2030-01-01T00:00:00.000Z",
    metadata: {
      accountId: "smoke-account",
      apiToken: "metadata-secret-must-not-persist"
    }
  }, 201, { authorization: `Bearer ${signedToken}` });
  if (signedConnector.connector.workspaceId !== "workspace_smoke" || signedConnector.connector.ownerUserId !== "user_smoke") {
    throw new Error(`Expected signed connector ownership metadata, got ${JSON.stringify(signedConnector.connector)}`);
  }
  if (signedConnector.connector.accessToken || signedConnector.connector.refreshToken || signedConnector.connector.encryptedAccessToken) {
    throw new Error(`Expected redacted connector response, got ${JSON.stringify(signedConnector.connector)}`);
  }
  if (signedConnector.connector.accessTokenStored !== true || signedConnector.connector.refreshTokenStored !== true || !signedConnector.connector.tokenKeyId) {
    throw new Error(`Expected stored token metadata, got ${JSON.stringify(signedConnector.connector)}`);
  }
  if (signedConnector.connector.metadata.apiToken || signedConnector.connector.metadata.accountId !== "smoke-account") {
    throw new Error(`Expected sanitized connector metadata, got ${JSON.stringify(signedConnector.connector.metadata)}`);
  }
  const storedConnector = await getRecord("connectors", signedConnector.connector.id);
  const storedConnectorJson = JSON.stringify(storedConnector);
  if (storedConnectorJson.includes("access-smoke-secret") || storedConnectorJson.includes("refresh-smoke-secret") || storedConnectorJson.includes("metadata-secret-must-not-persist")) {
    throw new Error(`Connector storage leaked plaintext token: ${storedConnectorJson}`);
  }
  if (decryptSecret(storedConnector.encryptedAccessToken) !== "access-smoke-secret" || decryptSecret(storedConnector.encryptedRefreshToken) !== "refresh-smoke-secret") {
    throw new Error("Expected encrypted connector tokens to decrypt with server key.");
  }
  const signedConnectorList = await expect("connector-list-signed-session", "GET", "connectors", null, 200, { authorization: `Bearer ${signedToken}` });
  if (!signedConnectorList.connectors.some(connector => connector.id === signedConnector.connector.id)) {
    throw new Error(`Expected signed connector in signed-session list, got ${JSON.stringify(signedConnectorList.connectors)}`);
  }
  const otherConnectorList = await expect("connector-list-other-session", "GET", "connectors", null, 200, { authorization: `Bearer ${otherToken}` });
  if (otherConnectorList.connectors.some(connector => connector.id === signedConnector.connector.id)) {
    throw new Error(`Expected other workspace connector list to exclude signed connector, got ${JSON.stringify(otherConnectorList.connectors)}`);
  }
  const forbiddenConnectorRead = await expect("connector-read-other-session", "GET", `connectors/${signedConnector.connector.id}`, null, 403, { authorization: `Bearer ${otherToken}` });
  if (forbiddenConnectorRead.error !== "forbidden") {
    throw new Error(`Expected forbidden signed-session connector read, got ${forbiddenConnectorRead.error}`);
  }
  await expect("connector-delete-signed-session", "DELETE", `connectors/${signedConnector.connector.id}`, null, 200, { authorization: `Bearer ${signedToken}` });
  delete process.env.HERMEST_TOKEN_ENCRYPTION_KEY;
  const signedAsset = await expect("asset-create-signed-session", "POST", "assets", {
    projectId: signedProject.project.id,
    title: "Signed reference",
    rightsStatus: "owned"
  }, 201, { authorization: `Bearer ${signedToken}` });
  if (signedAsset.asset.workspaceId !== signedProject.project.workspaceId || signedAsset.asset.ownerUserId !== signedProject.project.ownerUserId) {
    throw new Error(`Expected signed-session asset ownership metadata, got ${JSON.stringify(signedAsset.asset)}`);
  }
  const signedAssetList = await expect("asset-list-signed-session", "GET", "assets", null, 200, { authorization: `Bearer ${signedToken}` });
  if (!signedAssetList.assets.some(asset => asset.id === signedAsset.asset.id)) {
    throw new Error(`Expected signed asset in signed-session list, got ${JSON.stringify(signedAssetList.assets)}`);
  }
  const otherAssetList = await expect("asset-list-other-session", "GET", "assets", null, 200, { authorization: `Bearer ${otherToken}` });
  if (otherAssetList.assets.some(asset => asset.id === signedAsset.asset.id)) {
    throw new Error(`Expected other workspace asset list to exclude signed asset, got ${JSON.stringify(otherAssetList.assets)}`);
  }
  const forbiddenAssetAttach = await expect("asset-create-other-project-session", "POST", "assets", {
    projectId: signedProject.project.id,
    title: "Forbidden reference",
    rightsStatus: "owned"
  }, 403, { authorization: `Bearer ${otherToken}` });
  if (forbiddenAssetAttach.error !== "forbidden") {
    throw new Error(`Expected forbidden signed-session asset attach, got ${forbiddenAssetAttach.error}`);
  }
  const signedCandidateRequest = {
    projectId: signedProject.project.id,
    platforms: ["youtube_video"],
    recipe: { id: "youtube-16x9-1080p", version: "1.0.0", platform: "youtube_video", width: 1920, height: 1080 },
    artifacts: [
      { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "1".repeat(64) },
      { name: "youtube-16x9-1080p.manifest.json", type: "application/json", bytes: 2000, sha256: "2".repeat(64) }
    ],
    manifestSha256: "2".repeat(64)
  };
  const signedCandidate = await expect("publish-candidate-create-signed-session", "POST", "publish-candidates", signedCandidateRequest, 201, bearerHeaders(signedToken));
  if (signedCandidate.candidate.workspaceId !== "workspace_smoke" || signedCandidate.candidate.rights.status !== "owned") {
    throw new Error(`Expected signed candidate ownership and derived rights, got ${JSON.stringify(signedCandidate.candidate)}`);
  }
  const signedCandidateList = await expect("publish-candidate-list-signed-session", "GET", "publish-candidates", null, 200, bearerHeaders(signedToken));
  if (!signedCandidateList.candidates.some(candidate => candidate.id === signedCandidate.candidate.id)) {
    throw new Error(`Expected signed candidate in workspace list, got ${JSON.stringify(signedCandidateList.candidates)}`);
  }
  const otherCandidateList = await expect("publish-candidate-list-other-session", "GET", "publish-candidates", null, 200, bearerHeaders(otherToken));
  if (otherCandidateList.candidates.some(candidate => candidate.id === signedCandidate.candidate.id)) {
    throw new Error(`Expected other workspace candidate list to exclude record, got ${JSON.stringify(otherCandidateList.candidates)}`);
  }
  const forbiddenCandidateRead = await expect("publish-candidate-read-other-session", "GET", `publish-candidates/${signedCandidate.candidate.id}`, null, 403, bearerHeaders(otherToken));
  if (forbiddenCandidateRead.error !== "forbidden") {
    throw new Error(`Expected forbidden candidate read, got ${forbiddenCandidateRead.error}`);
  }
  const forbiddenCandidateCreate = await expect("publish-candidate-create-other-project", "POST", "publish-candidates", signedCandidateRequest, 403, bearerHeaders(otherToken));
  if (forbiddenCandidateCreate.error !== "forbidden") {
    throw new Error(`Expected forbidden candidate create, got ${forbiddenCandidateCreate.error}`);
  }
  const signedJob = await expect("job-create-signed-session", "POST", "jobs", {
    projectId: signedProject.project.id,
    publishPack: { platforms: ["youtube_video"], tools: ["parser"], languages: ["ru"] }
  }, 201, { authorization: `Bearer ${signedToken}` });
  if (signedJob.job.workspaceId !== signedProject.project.workspaceId || signedJob.job.ownerUserId !== signedProject.project.ownerUserId) {
    throw new Error(`Expected signed-session job ownership metadata, got ${JSON.stringify(signedJob.job)}`);
  }
  if (signedJob.job.approval.status !== "blocked") {
    throw new Error(`Expected blocked signed job approval state, got ${JSON.stringify(signedJob.job.approval)}`);
  }
  const signedJobList = await expect("job-list-signed-session", "GET", "jobs", null, 200, { authorization: `Bearer ${signedToken}` });
  if (!signedJobList.jobs.some(job => job.id === signedJob.job.id)) {
    throw new Error(`Expected signed job in signed-session list, got ${JSON.stringify(signedJobList.jobs)}`);
  }
  const otherJobList = await expect("job-list-other-session", "GET", "jobs", null, 200, { authorization: `Bearer ${otherToken}` });
  if (otherJobList.jobs.some(job => job.id === signedJob.job.id)) {
    throw new Error(`Expected other workspace job list to exclude signed job, got ${JSON.stringify(otherJobList.jobs)}`);
  }
  const forbiddenJobRead = await expect("job-read-other-session", "GET", `jobs/${signedJob.job.id}`, null, 403, { authorization: `Bearer ${otherToken}` });
  if (forbiddenJobRead.error !== "forbidden") {
    throw new Error(`Expected forbidden signed-session job read, got ${forbiddenJobRead.error}`);
  }
  const forbiddenJobPatch = await expect("job-patch-other-session", "PATCH", `jobs/${signedJob.job.id}`, {
    status: "running"
  }, 403, { authorization: `Bearer ${otherToken}` });
  if (forbiddenJobPatch.error !== "forbidden") {
    throw new Error(`Expected forbidden signed-session job patch, got ${forbiddenJobPatch.error}`);
  }
  const forbiddenJobApproval = await expect("job-approval-other-session", "POST", `jobs/${signedJob.job.id}/approval`, {
    action: "approve"
  }, 403, { authorization: `Bearer ${otherToken}` });
  if (forbiddenJobApproval.error !== "forbidden") {
    throw new Error(`Expected forbidden signed-session job approval, got ${forbiddenJobApproval.error}`);
  }
  const blockedJobApproval = await expect("job-approval-blocked-plan", "POST", `jobs/${signedJob.job.id}/approval`, {
    action: "approve"
  }, 409, { authorization: `Bearer ${signedToken}` });
  if (blockedJobApproval.error !== "job_approval_blocked") {
    throw new Error(`Expected job_approval_blocked, got ${blockedJobApproval.error}`);
  }
  const forbiddenJobCreate = await expect("job-create-other-project-session", "POST", "jobs", {
    projectId: signedProject.project.id,
    publishPack: { platforms: ["youtube_video"], tools: ["parser"], languages: ["ru"] }
  }, 403, { authorization: `Bearer ${otherToken}` });
  if (forbiddenJobCreate.error !== "forbidden") {
    throw new Error(`Expected forbidden signed-session job create, got ${forbiddenJobCreate.error}`);
  }
  const signedAudit = await expect("audit-list-signed-session", "GET", "audit", null, 200, { authorization: `Bearer ${signedToken}` });
  if (!signedAudit.audit.some(entry => entry.action === "asset.created" && entry.workspaceId === "workspace_smoke")) {
    throw new Error(`Expected signed-session audit list to include owned asset event, got ${JSON.stringify(signedAudit.audit)}`);
  }
  if (signedAudit.audit.some(entry => entry.workspaceId !== "workspace_smoke")) {
    throw new Error(`Expected signed-session audit list to contain only workspace_smoke, got ${JSON.stringify(signedAudit.audit)}`);
  }
  const otherAudit = await expect("audit-list-other-session", "GET", "audit", null, 200, { authorization: `Bearer ${otherToken}` });
  if (otherAudit.audit.some(entry => entry.workspaceId === "workspace_smoke")) {
    throw new Error(`Expected other workspace audit list to exclude signed audit entries, got ${JSON.stringify(otherAudit.audit)}`);
  }
  await expect("project-delete-signed-session", "DELETE", `projects/${signedProject.project.id}`, null, 200, { authorization: `Bearer ${signedToken}` });
  delete process.env.HERMEST_SESSION_SECRET;

  const created = await expect("project-create", "POST", "projects", {
    project: {
      title: "API smoke",
      cards: [{ id: "card1", title: "One", text: "Test" }],
      links: [],
      publish: { platforms: ["youtube_video"], languages: "ru" }
    }
  }, 201);
  const id = created.project.id;
  if (created.project.workspaceId !== "workspace_local" || created.project.ownerUserId !== "local-dev") {
    throw new Error(`Expected local project ownership metadata, got ${JSON.stringify(created.project)}`);
  }
  if (created.project.project.workspaceId !== created.project.workspaceId || created.project.project.ownerUserId !== created.project.ownerUserId) {
    throw new Error(`Expected board document ownership metadata, got ${JSON.stringify(created.project.project)}`);
  }

  const fetched = await expect("project-get", "GET", `projects/${id}`, null, 200);
  if (fetched.project.workspaceId !== created.project.workspaceId || fetched.project.ownerUserId !== created.project.ownerUserId) {
    throw new Error(`Expected fetched ownership metadata to persist, got ${JSON.stringify(fetched.project)}`);
  }
  const updated = await expect("project-update", "PUT", `projects/${id}`, {
    workspaceId: "workspace_payload_must_not_take_over",
    ownerUserId: "payload-owner",
    project: {
      title: "API smoke updated",
      workspaceId: "workspace_payload_must_not_take_over",
      ownerUserId: "payload-owner",
      cards: [{ id: "card1", title: "One", text: "Updated" }],
      links: [],
      publish: { platforms: ["youtube_video"], languages: "ru,en" }
    }
  }, 200);
  if (updated.project.workspaceId !== created.project.workspaceId || updated.project.ownerUserId !== created.project.ownerUserId) {
    throw new Error(`Expected update to preserve ownership metadata, got ${JSON.stringify(updated.project)}`);
  }
  const createdAsset = await expect("asset-create", "POST", "assets", {
    projectId: id,
    title: "Reference",
    url: "https://example.com/reference",
    rightsStatus: "unknown"
  }, 201);
  if (createdAsset.asset.workspaceId !== created.project.workspaceId || createdAsset.asset.ownerUserId !== created.project.ownerUserId) {
    throw new Error(`Expected asset to inherit project ownership, got ${JSON.stringify(createdAsset.asset)}`);
  }
  const invalidAssetRights = await expect("asset-invalid-rights-status", "POST", "assets", {
    projectId: id,
    title: "Invalid rights",
    rightsStatus: "unreviewed"
  }, 400);
  if (invalidAssetRights.error !== "invalid_asset_rights_status") {
    throw new Error(`Expected invalid_asset_rights_status, got ${invalidAssetRights.error}`);
  }
  const candidateRequest = {
    projectId: id,
    platforms: ["youtube_video"],
    recipe: {
      id: "youtube-16x9-1080p",
      version: "1.0.0",
      platform: "youtube_video",
      width: 1920,
      height: 1080
    },
    artifacts: [
      { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) },
      { name: "youtube-16x9-1080p.manifest.json", type: "application/json", bytes: 2000, sha256: "b".repeat(64) }
    ],
    manifestSha256: "b".repeat(64),
    evidence: { status: "server_verified", verifier: "request-must-be-ignored" },
    rights: { status: "allowed" },
    localPath: "/tmp/request-must-be-ignored",
    token: "candidate-request-secret-must-not-survive"
  };
  const metadataCandidate = await expect("publish-candidate-create", "POST", "publish-candidates", candidateRequest, 201);
  if (metadataCandidate.candidate.status !== "sealed" || metadataCandidate.candidate.evidence.status !== "metadata_only" || metadataCandidate.candidate.approvable !== false) {
    throw new Error(`Expected sealed metadata-only candidate, got ${JSON.stringify(metadataCandidate.candidate)}`);
  }
  if (!metadataCandidate.candidate.approvalBlockers.includes("artifact_verification_required") || !metadataCandidate.candidate.approvalBlockers.includes("asset_rights_not_cleared")) {
    throw new Error(`Expected verification and rights blockers, got ${JSON.stringify(metadataCandidate.candidate.approvalBlockers)}`);
  }
  const serializedCandidate = JSON.stringify(metadataCandidate);
  if (serializedCandidate.includes("/tmp/") || serializedCandidate.includes("candidate-request-secret-must-not-survive")) {
    throw new Error("Publish candidate response leaked ignored request metadata.");
  }
  const repeatedCandidate = await expect("publish-candidate-idempotent", "POST", "publish-candidates", candidateRequest, 200);
  if (repeatedCandidate.created !== false || repeatedCandidate.candidate.id !== metadataCandidate.candidate.id) {
    throw new Error(`Expected deterministic idempotent candidate, got ${JSON.stringify(repeatedCandidate)}`);
  }
  const fetchedCandidate = await expect("publish-candidate-read", "GET", `publish-candidates/${metadataCandidate.candidate.id}`, null, 200);
  if (fetchedCandidate.candidate.digest !== metadataCandidate.candidate.digest) {
    throw new Error(`Expected immutable candidate read, got ${JSON.stringify(fetchedCandidate.candidate)}`);
  }
  const blockedJob = await expect("job-create", "POST", "jobs", {
    projectId: id,
    publishPack: { platforms: ["youtube_video"], tools: ["parser"], languages: ["ru"] }
  }, 201);
  if (blockedJob.job.workspaceId !== created.project.workspaceId || blockedJob.job.ownerUserId !== created.project.ownerUserId) {
    throw new Error(`Expected job to inherit project ownership, got ${JSON.stringify(blockedJob.job)}`);
  }
  if (blockedJob.job.status !== "blocked") {
    throw new Error(`Expected blocked job, got ${blockedJob.job.status}`);
  }

  process.env.DATABASE_URL = "postgres://smoke.invalid/hermest";
  process.env.YOUTUBE_CLIENT_ID = "smoke-client-id";
  process.env.YOUTUBE_CLIENT_SECRET = "smoke-client-secret";
  const configuredConnectorJob = await expect("job-configured-connector-still-blocked", "POST", "jobs", {
    projectId: id,
    publishPack: { platforms: ["youtube_video"], tools: ["parser"], languages: ["ru"] }
  }, 201);
  if (configuredConnectorJob.job.status !== "blocked" || configuredConnectorJob.job.plan.connectors.youtube.configured !== true || configuredConnectorJob.job.plan.connectors.youtube.executable !== false) {
    throw new Error(`Expected configured OAuth slot to remain blocked, got ${JSON.stringify(configuredConnectorJob.job)}`);
  }
  const verifiedCandidate = buildPublishCandidate({
    projectRecord: created.project,
    platforms: ["youtube_video"],
    recipe: candidateRequest.recipe,
    // Обложка обязательна для одобрения с тех пор, как каждая площадка стала
    // требовать cover_frame: фикстура одобряемого кандидата обязана её нести,
    // иначе smoke проверяет не одобрение, а свой устаревший набор артефактов.
    artifacts: [
      ...candidateRequest.artifacts,
      { name: `${candidateRequest.recipe.id}.cover.png`, type: "image/png", bytes: 4096, sha256: "c".repeat(64) }
    ],
    manifestSha256: candidateRequest.manifestSha256,
    rights: { status: "allowed", assetIds: [createdAsset.asset.id] },
    evidence: { status: "server_verified", verifier: "smoke-internal-worker-v1" },
    createdAt: "2026-07-13T12:00:00.000Z"
  });
  await saveRecord("publishCandidates", verifiedCandidate);
  const candidateBinding = {
    id: verifiedCandidate.id,
    digest: verifiedCandidate.digest,
    version: verifiedCandidate.version,
    status: verifiedCandidate.status,
    evidenceStatus: verifiedCandidate.evidence.status,
    approvable: verifiedCandidate.approvable
  };
  const approvalJob = {
    ...configuredConnectorJob.job,
    id: "job_future_ready_approval_fixture",
    status: "waiting_for_approval",
    candidate: candidateBinding,
    plan: {
      ...configuredConnectorJob.job.plan,
      status: "ready_for_human_approval",
      blockers: []
    },
    approval: {
      required: true,
      status: "pending",
      candidate: candidateBinding
    }
  };
  await saveRecord("jobs", approvalJob);
  if (approvalJob.approval.status !== "pending") {
    throw new Error(`Expected pending synthetic approval fixture, got ${JSON.stringify(approvalJob.approval)}`);
  }
  const staleApproval = await expect("job-approval-stale-candidate", "POST", `jobs/${approvalJob.id}/approval`, {
    action: "approve",
    candidateId: verifiedCandidate.id,
    candidateDigest: "c".repeat(64),
    candidateVersion: verifiedCandidate.version
  }, 409);
  if (staleApproval.error !== "job_candidate_binding_mismatch") {
    throw new Error(`Expected stale candidate binding rejection, got ${JSON.stringify(staleApproval)}`);
  }
  const approvedJob = await expect("job-approval-approve", "POST", `jobs/${approvalJob.id}/approval`, {
    action: "approve",
    candidateId: verifiedCandidate.id,
    candidateDigest: verifiedCandidate.digest,
    candidateVersion: verifiedCandidate.version,
    note: "Smoke approval"
  }, 200);
  if (approvedJob.job.approval.status !== "approved" || approvedJob.job.approval.candidate?.digest !== verifiedCandidate.digest || approvedJob.job.status !== "blocked" || approvedJob.job.execution.canAutopublish !== false) {
    throw new Error(`Expected approved but execution-blocked job, got ${JSON.stringify(approvedJob.job)}`);
  }
  if (!approvedJob.job.execution.blockers.includes("durable_job_queue_not_implemented")) {
    throw new Error(`Expected durable queue execution blocker, got ${JSON.stringify(approvedJob.job.execution)}`);
  }
  const blockedExecution = await expect("job-update-running-blocked", "PATCH", `jobs/${approvalJob.id}`, {
    status: "running"
  }, 409);
  if (blockedExecution.error !== "job_execution_blocked") {
    throw new Error(`Expected job_execution_blocked, got ${JSON.stringify(blockedExecution)}`);
  }
  const invalidJobStatus = await expect("job-invalid-status", "PATCH", `jobs/${approvalJob.id}`, {
    status: "ready_for_approval"
  }, 400);
  if (invalidJobStatus.error !== "invalid_job_status") {
    throw new Error(`Expected invalid_job_status, got ${invalidJobStatus.error}`);
  }
  delete process.env.DATABASE_URL;
  delete process.env.YOUTUBE_CLIENT_ID;
  delete process.env.YOUTUBE_CLIENT_SECRET;

  const auditList = await expect("audit-list", "GET", "audit", null, 200);
  if (auditList.audit.some(entry => !entry.workspaceId || !entry.ownerUserId)) {
    throw new Error(`Expected audit entries to include ownership metadata, got ${JSON.stringify(auditList.audit)}`);
  }
  await expect("project-delete", "DELETE", `projects/${id}`, null, 200);

  process.env.VERCEL = "1";
  delete process.env.HERMEST_ENABLE_DEMO_STORAGE;
  delete process.env.HERMEST_SESSION_SECRET;
  process.env.DATABASE_URL = "postgres://smoke.invalid/hermest";
  const externalStorageStatus = await expect("external-storage-status", "GET", "storage/status", null, 200);
  if (externalStorageStatus.writeEnabled !== false || externalStorageStatus.durable !== false) {
    throw new Error(`Expected external env to stay guarded, got ${JSON.stringify(externalStorageStatus)}`);
  }
  if (!externalStorageStatus.warnings?.includes("external_storage_env_detected_but_adapter_not_enabled_yet")) {
    throw new Error(`Expected external storage warning, got ${JSON.stringify(externalStorageStatus.warnings)}`);
  }
  process.env.HERMEST_STORAGE_ADAPTER = "postgres";
  const disabledPostgresStatus = await expect("postgres-storage-disabled", "GET", "storage/status", null, 200);
  if (disabledPostgresStatus.adapter !== "json-file" || disabledPostgresStatus.durableAdapterConfigured !== true || disabledPostgresStatus.durableAdapterEnabled !== false || disabledPostgresStatus.writeEnabled !== false) {
    throw new Error(`Expected configured Postgres adapter to stay disabled, got ${JSON.stringify(disabledPostgresStatus)}`);
  }
  if (!disabledPostgresStatus.warnings?.includes("durable_postgres_adapter_configured_but_not_enabled")) {
    throw new Error(`Expected disabled Postgres warning, got ${JSON.stringify(disabledPostgresStatus.warnings)}`);
  }
  process.env.HERMEST_ENABLE_DURABLE_STORAGE = "1";
  const enabledPostgresNoAuthStatus = await expect("postgres-storage-enabled-without-auth", "GET", "storage/status", null, 200);
  if (enabledPostgresNoAuthStatus.adapter !== "postgres-jsonb" || enabledPostgresNoAuthStatus.durableAdapterEnabled !== true || enabledPostgresNoAuthStatus.writeEnabled !== false) {
    throw new Error(`Expected Postgres adapter active but write-blocked without auth, got ${JSON.stringify(enabledPostgresNoAuthStatus)}`);
  }
  if (!enabledPostgresNoAuthStatus.warnings?.includes("durable_postgres_adapter_enabled_without_auth_guard")) {
    throw new Error(`Expected auth guard warning for enabled Postgres, got ${JSON.stringify(enabledPostgresNoAuthStatus.warnings)}`);
  }
  const durableAuthBlocked = await expect("postgres-storage-write-auth-guard", "POST", "projects", {
    project: { title: "blocked durable" }
  }, 501);
  if (durableAuthBlocked.error !== "write_auth_not_configured") {
    throw new Error(`Expected durable write_auth_not_configured, got ${durableAuthBlocked.error}`);
  }
  delete process.env.HERMEST_ENABLE_DURABLE_STORAGE;
  delete process.env.HERMEST_STORAGE_ADAPTER;
  delete process.env.DATABASE_URL;

  const guarded = await expect("production-write-guard", "POST", "projects", {
    project: { title: "blocked" }
  }, 501);
  if (guarded.error !== "server_storage_not_configured") {
    throw new Error(`Expected storage guard, got ${guarded.error}`);
  }

  process.env.HERMEST_ENABLE_DEMO_STORAGE = "1";
  const readAuthBlocked = await expect("demo-storage-read-auth-guard", "GET", "projects", null, 501);
  if (readAuthBlocked.error !== "read_auth_not_configured") {
    throw new Error(`Expected read_auth_not_configured, got ${readAuthBlocked.error}`);
  }

  const authBlocked = await expect("demo-storage-auth-guard", "POST", "projects", {
    project: { title: "blocked" }
  }, 501);
  if (authBlocked.error !== "write_auth_not_configured") {
    throw new Error(`Expected auth guard, got ${authBlocked.error}`);
  }

  process.env.HERMEST_OWNER_TOKEN = "local-owner-token";
  const ownerSession = await expect("session-current-owner", "GET", "session/current", null, 200, { authorization: "Bearer local-owner-token" });
  if (ownerSession.actor.id !== "owner" || ownerSession.session.realUserAuthImplemented !== true || ownerSession.session.realUserAuthEnabled !== false) {
    throw new Error(`Expected owner bootstrap session, got ${JSON.stringify(ownerSession)}`);
  }
  const readUnauthorized = await expect("demo-storage-read-token-required", "GET", "projects", null, 401);
  if (readUnauthorized.error !== "unauthorized") {
    throw new Error(`Expected unauthorized read guard, got ${readUnauthorized.error}`);
  }
  await expect("owner-token-read", "GET", "projects", null, 200, { authorization: "Bearer local-owner-token" });
  const authed = await expect("owner-token-write", "POST", "projects", {
    project: { title: "owner ok", cards: [] }
  }, 201, { authorization: "Bearer local-owner-token" });
  if (authed.project.workspaceId !== "workspace_owner" || authed.project.ownerUserId !== "owner") {
    throw new Error(`Expected owner-token ownership metadata, got ${JSON.stringify(authed.project)}`);
  }
  await expect("owner-token-read-created", "GET", `projects/${authed.project.id}`, null, 200, { authorization: "Bearer local-owner-token" });
  await expect("owner-token-delete", "DELETE", `projects/${authed.project.id}`, null, 200, { authorization: "Bearer local-owner-token" });

  console.log("smoke:api ok");
} finally {
  process.env = originalEnv;
  rmSync(dataDir, { recursive: true, force: true });
}

async function expect(name, method, route, body, expectedStatus, headers = {}) {
  const response = mockResponse();
  await product({
    method,
    query: { route },
    url: `/api/product?route=${encodeURIComponent(route)}`,
    headers,
    body
  }, response);
  if (response.statusCode !== expectedStatus) {
    throw new Error(`${name}: expected ${expectedStatus}, got ${response.statusCode} ${JSON.stringify(response.payload)}`);
  }
  if (response.payload?.ok === false && expectedStatus < 400) {
    throw new Error(`${name}: expected ok payload, got ${JSON.stringify(response.payload)}`);
  }
  if (response.payload && typeof response.payload === "object") {
    Object.defineProperty(response.payload, "_headers", {
      value: response.headers,
      enumerable: false
    });
  }
  return response.payload;
}

async function expectConnector(name, handler, method, query, body = null, expectedStatus = 200, headers = {}) {
  const response = mockResponse();
  await handler({
    method,
    query,
    url: `/api/connectors/${name}?${new URLSearchParams(query).toString()}`,
    headers,
    body
  }, response);
  if (response.statusCode !== expectedStatus) {
    throw new Error(`${name}: expected ${expectedStatus}, got ${response.statusCode} ${JSON.stringify(response.payload)}`);
  }
  if (response.payload?.ok === false && expectedStatus < 400) {
    throw new Error(`${name}: expected ok payload, got ${JSON.stringify(response.payload)}`);
  }
  return response.payload;
}

async function expectAi(name, method, body, expectedStatus, headers = {}) {
  const response = mockResponse();
  await aiRespond({
    method,
    query: {},
    url: "/api/ai/respond",
    headers,
    body
  }, response);
  if (response.statusCode !== expectedStatus) {
    throw new Error(`${name}: expected ${expectedStatus}, got ${response.statusCode} ${JSON.stringify(response.payload)}`);
  }
  if (response.payload?.ok === false && expectedStatus < 400) {
    throw new Error(`${name}: expected ok payload, got ${JSON.stringify(response.payload)}`);
  }
  return response.payload;
}

function bearerHeaders(token) {
  return {
    authorization: ["Bearer", String(token || "")].join(" ")
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}
