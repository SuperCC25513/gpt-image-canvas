process.env.GENERATION_QUEUE_DRIVER = "inline";
process.env.GENERATION_PROVIDER_GLOBAL_CONCURRENCY = "1";
process.env.GENERATION_PROVIDER_MAX_RETRIES = "2";
process.env.GENERATION_PROVIDER_RETRY_BASE_MS = "100";
process.env.GENERATION_PROVIDER_RETRY_MAX_MS = "100";
process.env.GENERATION_PROVIDER_PERMIT_TTL_MS = "10000";

async function main(): Promise<void> {
  const [{ closeRedisClient }, { ProviderError }, retryPolicy] = await Promise.all([
    import("../infrastructure/redis-runtime.js"),
    import("../infrastructure/providers/image-provider.js"),
    import("../domain/generation/provider-retry-policy.js")
  ]);
  const { classifyProviderRetry, getProviderRetryConfig, readProviderRetryConfig, runProviderCallWithRetry } = retryPolicy;

  try {
    const defaults = readProviderRetryConfig({});
    expect(defaults.maxRetries === 2, "default provider max retries is 2");
    expect(defaults.baseDelayMs === 1000, "default provider retry base delay is 1000ms");
    expect(defaults.maxDelayMs === 30000, "default provider retry max delay is 30000ms");

    const parsed = readProviderRetryConfig({
      GENERATION_PROVIDER_MAX_RETRIES: "3",
      GENERATION_PROVIDER_RETRY_BASE_MS: "250",
      GENERATION_PROVIDER_RETRY_MAX_MS: "5000"
    });
    expect(parsed.maxRetries === 3, "configured provider max retries is accepted");
    expect(parsed.baseDelayMs === 250, "configured provider retry base delay is accepted");
    expect(parsed.maxDelayMs === 5000, "configured provider retry max delay is accepted");

    const invalid = readProviderRetryConfig({
      GENERATION_PROVIDER_MAX_RETRIES: "-1",
      GENERATION_PROVIDER_RETRY_BASE_MS: "0",
      GENERATION_PROVIDER_RETRY_MAX_MS: "bad-value"
    });
    expect(invalid.maxRetries === 2, "invalid provider max retries falls back to default");
    expect(invalid.baseDelayMs === 1000, "invalid provider retry base delay falls back to default");
    expect(invalid.maxDelayMs === 30000, "invalid provider retry max delay falls back to default");

    const runtimeConfig = getProviderRetryConfig();
    expect(runtimeConfig.maxRetries === 2, "runtime retry config honors smoke max retries env");
    expect(runtimeConfig.baseDelayMs === 100, "runtime retry config honors smoke base delay env");
    expect(runtimeConfig.maxDelayMs === 100, "runtime retry config honors smoke max delay env");

    expect(
      classifyProviderRetry(new ProviderError("upstream_failure", "rate limited", 429), 1, 3).retry === true,
      "HTTP 429 is retryable"
    );
    expect(
      classifyProviderRetry(new ProviderError("upstream_failure", "request timeout", 408), 1, 3).retry === true,
      "HTTP 408 is retryable"
    );
    expect(
      classifyProviderRetry(new ProviderError("upstream_failure", "server failed", 502), 1, 3).retry === true,
      "HTTP 5xx is retryable"
    );
    expect(
      classifyProviderRetry(new Error("fetch failed: connection reset"), 1, 3).retry === true,
      "temporary network error is retryable"
    );
    expect(
      classifyProviderRetry(new ProviderError("unsupported_provider_behavior", "bad reference image", 400), 1, 3).retry === false,
      "HTTP 400 provider error is not retryable"
    );
    expect(
      classifyProviderRetry(new ProviderError("missing_api_key", "missing key", 500), 1, 3).retry === false,
      "missing API key is not retryable"
    );
    expect(
      classifyProviderRetry(new DOMException("The operation was aborted.", "AbortError"), 1, 3).retry === false,
      "abort is not retryable"
    );

    let attempts = 0;
    const recovered = await runProviderCallWithRetry({
      generationId: "smoke-retry-success",
      outputId: "smoke-retry-success-output",
      outputIndex: 0,
      mode: "generate",
      call: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new ProviderError("upstream_failure", "temporary upstream failure", 429);
        }
        return "ok";
      }
    });
    expect(recovered === "ok", "retryable provider call eventually succeeds");
    expect(attempts === 3, "retryable provider call uses configured attempts");

    let missingProviderAttempts = 0;
    await expectRejects(
      runProviderCallWithRetry({
        generationId: "smoke-no-retry",
        outputId: "smoke-no-retry-output",
        outputIndex: 0,
        mode: "generate",
        call: async () => {
          missingProviderAttempts += 1;
          throw new ProviderError("missing_provider", "missing provider", 401);
        }
      }),
      "missing provider"
    );
    expect(missingProviderAttempts === 1, "non-retryable provider error is attempted once");

    let slowRetryAttempts = 0;
    const slowRetry = runProviderCallWithRetry({
      generationId: "smoke-slow-retry",
      outputId: "smoke-slow-retry-output",
      outputIndex: 0,
      mode: "generate",
      call: async () => {
        slowRetryAttempts += 1;
        if (slowRetryAttempts === 1) {
          throw new ProviderError("upstream_failure", "temporary upstream failure", 429);
        }
        return "slow-ok";
      }
    });
    await waitUntil(() => slowRetryAttempts === 1);
    const secondResult = await runProviderCallWithRetry({
      generationId: "smoke-permit-release",
      outputId: "smoke-permit-release-output",
      outputIndex: 1,
      mode: "edit",
      call: async () => "permit-released"
    });
    expect(secondResult === "permit-released", "retry backoff does not hold provider permit");
    expect((await slowRetry) === "slow-ok", "slow retry still completes");

    const abortController = new AbortController();
    let abortedAttempts = 0;
    const abortedRetry = runProviderCallWithRetry({
      generationId: "smoke-abort-retry",
      outputId: "smoke-abort-retry-output",
      outputIndex: 0,
      mode: "generate",
      signal: abortController.signal,
      call: async () => {
        abortedAttempts += 1;
        throw new ProviderError("upstream_failure", "temporary upstream failure", 429);
      }
    });
    await waitUntil(() => abortedAttempts === 1);
    abortController.abort();
    await expectAbort(abortedRetry);
    expect(abortedAttempts === 1, "abort during retry delay stops new attempts");

    await expectRejectsWithoutSecrets(
      runProviderCallWithRetry({
        generationId: "smoke-exhausted",
        outputId: "smoke-exhausted-output",
        outputIndex: 0,
        mode: "generate",
        call: async () => {
          throw new ProviderError(
            "upstream_failure",
            "upstream failed for Bearer super.secret.token and sk-live-secret",
            502
          );
        }
      })
    );

    console.log("provider retry policy smoke checks passed");
  } finally {
    await closeRedisClient();
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for smoke condition.");
    }
    await delay(5);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectRejects(promise: Promise<unknown>, messageIncludes: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error instanceof Error && error.message.includes(messageIncludes), `expected rejection containing ${messageIncludes}`);
    return;
  }
  throw new Error("Expected promise to reject.");
}

async function expectRejectsWithoutSecrets(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error instanceof Error, "expected exhausted retry to reject with Error");
    expect(error.message.includes("图像服务暂时不可用"), "exhausted retry uses stable summary");
    expect(!error.message.includes("Bearer"), "exhausted retry message redacts bearer token");
    expect(!error.message.includes("sk-live-secret"), "exhausted retry message redacts OpenAI-style key");
    return;
  }
  throw new Error("Expected promise to reject.");
}

async function expectAbort(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error instanceof DOMException && error.name === "AbortError", "expected AbortError");
    return;
  }
  throw new Error("Expected promise to abort.");
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
