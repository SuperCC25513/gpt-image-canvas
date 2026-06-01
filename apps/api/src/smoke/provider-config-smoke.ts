import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `provider-config-smoke-${process.pid}-${Date.now()}`);

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_BASE_URL;

mkdirSync(dataDir, { recursive: true });

async function main(): Promise<void> {
  const [{ closeDatabase, db }, { providerConfigs, agentLlmConfigs, codexOAuthTokens }, providerConfig, agentConfig, codexAuth] =
    await Promise.all([
      import("../infrastructure/database.js"),
      import("../infrastructure/schema.js"),
      import("../domain/providers/provider-config.js"),
      import("../domain/agent/config.js"),
      import("../domain/providers/codex-auth.js")
    ]);

  try {
    const initialProvider = await providerConfig.getProviderConfig();
    expect(initialProvider.sourceOrder.join(",") === "env-openai,local-openai,codex", "provider source order defaults");
    expect(!initialProvider.localOpenAI.apiKey.hasSecret, "provider local key starts empty");

    const savedProvider = await providerConfig.saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      localOpenAI: {
        apiKey: "sk-local-provider-secret",
        baseUrl: "https://provider.example/v1",
        model: "gpt-image-2",
        timeoutMs: 120000
      }
    });
    expect(savedProvider.localOpenAI.apiKey.hasSecret, "saved provider key is present");
    expect(savedProvider.localOpenAI.apiKey.value !== "sk-local-provider-secret", "provider key is masked");
    expect(savedProvider.activeSource?.id === "local-openai", "local provider becomes active");
    expect((await providerConfig.getProviderSourceOrder())[0] === "local-openai", "saved source order is readable");
    expect((await providerConfig.getLocalOpenAIImageProviderConfig())?.apiKey === "sk-local-provider-secret", "runtime provider reads raw key");

    await expectRejects(
      () =>
        providerConfig.saveProviderConfig({
          sourceOrder: ["local-openai", "env-openai", "codex"],
          localOpenAI: {
            apiKey: "sk-local-provider-secret",
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "gpt-image-2",
            timeoutMs: 120000
          }
        }),
      "local provider base URL is rejected without explicit dev override"
    );

    process.env.ALLOW_LOCAL_PROVIDER_BASE_URL = "true";
    const localDevProvider = await providerConfig.saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      localOpenAI: {
        apiKey: "sk-local-provider-secret",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "gpt-image-2",
        timeoutMs: 120000
      }
    });
    expect(localDevProvider.localOpenAI.baseUrl === "http://127.0.0.1:11434/v1", "explicit dev override allows loopback provider base URL");
    delete process.env.ALLOW_LOCAL_PROVIDER_BASE_URL;

    await providerConfig.saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      localOpenAI: {
        apiKey: savedProvider.localOpenAI.apiKey.value,
        baseUrl: "https://provider.example/v1",
        model: "gpt-image-2",
        timeoutMs: 90000
      }
    });
    expect((await providerConfig.getLocalOpenAIImageProviderConfig())?.apiKey === "sk-local-provider-secret", "masked provider key preserves raw key");

    db.update(providerConfigs).set({ sourceOrderJson: "not-json" }).run();
    expect((await providerConfig.getProviderSourceOrder()).join(",") === "env-openai,local-openai,codex", "bad provider source JSON falls back");

    const initialAgent = await agentConfig.getAgentLlmConfig();
    expect(!initialAgent.configured, "agent config starts unconfigured");

    const savedAgent = await agentConfig.saveAgentLlmConfig({
      apiKey: "sk-agent-secret",
      baseUrl: "https://agent.example/v1",
      model: "gpt-5",
      timeoutMs: 60000,
      supportsVision: true
    });
    expect(savedAgent.configured, "saved agent config is configured");
    expect(savedAgent.apiKey.value !== "sk-agent-secret", "agent key is masked");
    expect((await agentConfig.getUsableAgentLlmConfig())?.apiKey === "sk-agent-secret", "runtime agent config reads raw key");

    await expectRejects(
      () =>
        agentConfig.saveAgentLlmConfig({
          apiKey: "sk-agent-secret",
          baseUrl: "http://169.254.169.254/latest",
          model: "gpt-5",
          timeoutMs: 60000,
          supportsVision: true
        }),
      "agent base URL rejects metadata service targets"
    );

    await agentConfig.saveAgentLlmConfig({
      apiKey: savedAgent.apiKey.value,
      preserveApiKey: true,
      baseUrl: "https://agent.example/v1",
      model: "gpt-5",
      timeoutMs: 45000,
      supportsVision: false
    });
    const preservedAgent = await agentConfig.getUsableAgentLlmConfig();
    expect(preservedAgent?.apiKey === "sk-agent-secret", "masked agent key preserves raw key");
    expect(preservedAgent?.timeoutMs === 45000, "agent non-secret fields update");

    const now = new Date().toISOString();
    db.insert(codexOAuthTokens)
      .values({
        id: "default",
        accessToken: "codex-access-token",
        refreshToken: "codex-refresh-token",
        idToken: "codex-id-token",
        email: "codex@example.com",
        accountId: "account-1",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        refreshedAt: now,
        unavailableAt: null,
        unavailableReason: null,
        createdAt: now,
        updatedAt: now
      })
      .run();
    const codexSource = (await providerConfig.getProviderConfig()).sources.find((source) => source.id === "codex");
    expect(codexSource?.available, "provider config sees codex token");

    const logout = await codexAuth.logoutCodex();
    expect(logout.ok, "codex logout succeeds");
    const loggedOutCodex = (await providerConfig.getProviderConfig()).sources.find((source) => source.id === "codex");
    expect(loggedOutCodex?.available === false, "codex logout clears availability");

    const providerRows = db.select().from(providerConfigs).all();
    const agentRows = db.select().from(agentLlmConfigs).all();
    expect(providerRows.length === 1 && providerRows[0]?.id === "active", "provider active row remains single");
    expect(agentRows.length === 1 && agentRows[0]?.id === "active", "agent active row remains single");

    console.log("provider config smoke checks passed");
  } finally {
    await closeDatabase();
    rmSync(dataDir, { force: true, recursive: true });
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function expectRejects(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }

  throw new Error(`Assertion failed: ${message}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
