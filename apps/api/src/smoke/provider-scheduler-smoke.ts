process.env.GENERATION_QUEUE_DRIVER ??= "inline";
process.env.GENERATION_PROVIDER_PERMIT_TTL_MS ??= "10000";

async function main(): Promise<void> {
  const [{ closeRedisClient }, providerScheduler] = await Promise.all([
    import("../infrastructure/redis-runtime.js"),
    import("../domain/generation/provider-scheduler.js")
  ]);
  const { getProviderSchedulerConfig, readProviderSchedulerConfig, runProviderCall } = providerScheduler;

  try {
    const defaults = readProviderSchedulerConfig({});
    expect(defaults.globalConcurrency === 2, "default provider global concurrency is 2");
    expect(defaults.permitTtlMs === 30 * 60 * 1000, "default provider permit TTL is 30 minutes");

    const parsed = readProviderSchedulerConfig({
      GENERATION_PROVIDER_GLOBAL_CONCURRENCY: "3",
      GENERATION_PROVIDER_PERMIT_TTL_MS: "2500"
    });
    expect(parsed.globalConcurrency === 3, "configured provider global concurrency is accepted");
    expect(parsed.permitTtlMs === 2500, "configured provider permit TTL is accepted");

    const invalid = readProviderSchedulerConfig({
      GENERATION_PROVIDER_GLOBAL_CONCURRENCY: "0",
      GENERATION_PROVIDER_PERMIT_TTL_MS: "bad-value"
    });
    expect(invalid.globalConcurrency === 2, "invalid provider global concurrency falls back to default");
    expect(invalid.permitTtlMs === 30 * 60 * 1000, "invalid provider permit TTL falls back to default");

    const runtimeConfig = getProviderSchedulerConfig();
    const concurrentCallCount = Math.max(5, runtimeConfig.globalConcurrency + 3);
    const concurrency = await runConcurrentProviderCalls(runProviderCall, concurrentCallCount);
    expect(concurrency.completed === concurrentCallCount, "queued provider calls all complete");
    expect(
      concurrency.maxActive === runtimeConfig.globalConcurrency,
      "provider calls do not exceed runtime global concurrency"
    );

    await expectRejects(
      runProviderCall({
        generationId: "smoke-failure",
        outputId: "smoke-failure-output",
        outputIndex: 0,
        mode: "generate",
        call: async () => {
          throw new Error("fake provider failure");
        }
      }),
      "fake provider failure"
    );

    const afterFailure = await runConcurrentProviderCalls(runProviderCall, 1);
    expect(afterFailure.completed === 1, "permit is released after provider failure");

    const abortController = new AbortController();
    const unblocks: Array<() => void> = [];
    const blockers = Array.from({ length: runtimeConfig.globalConcurrency }, (_, index) =>
      runProviderCall({
        generationId: `smoke-blocker-${index}`,
        outputId: `smoke-blocker-output-${index}`,
        outputIndex: index,
        mode: "generate",
        call: async () =>
          new Promise<string>((resolve) => {
            unblocks[index] = () => resolve(`released-${index}`);
          })
      })
    );
    await waitUntil(() => unblocks.filter(Boolean).length === runtimeConfig.globalConcurrency);

    let enteredAbortedCall = false;
    const aborted = runProviderCall({
      generationId: "smoke-abort",
      outputId: "smoke-abort-output",
      outputIndex: 0,
      mode: "edit",
      signal: abortController.signal,
      call: async () => {
        enteredAbortedCall = true;
        return "should-not-run";
      }
    });
    abortController.abort();
    await expectAbort(aborted);
    expect(enteredAbortedCall === false, "aborted waiting call does not enter provider");

    unblocks.forEach((unblock) => unblock());
    const released = await Promise.all(blockers);
    expect(released.length === runtimeConfig.globalConcurrency, "blocking provider calls complete after release");

    console.log("provider scheduler smoke checks passed");
  } finally {
    await closeRedisClient();
  }
}

async function runConcurrentProviderCalls(
  runProviderCall: typeof import("../domain/generation/provider-scheduler.js").runProviderCall,
  count: number
): Promise<{ completed: number; maxActive: number }> {
  let active = 0;
  let maxActive = 0;
  let completed = 0;

  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      runProviderCall({
        generationId: `smoke-generation-${index}`,
        outputId: `smoke-output-${index}`,
        outputIndex: index,
        mode: "generate",
        call: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(20);
          active -= 1;
          completed += 1;
          return `ok-${index}`;
        }
      })
    )
  );

  return { completed, maxActive };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function expectRejects(promise: Promise<unknown>, messageIncludes: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error instanceof Error && error.message.includes(messageIncludes), `expected rejection containing ${messageIncludes}`);
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
