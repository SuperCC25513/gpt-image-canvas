process.env.GENERATION_QUEUE_DRIVER = "inline";

async function main(): Promise<void> {
  const redisRuntime = await import("../infrastructure/redis-runtime.js");
  const {
    assertRedisReady,
    checkRedisHealth,
    closeRedisClient,
    readRedisRuntimeConfig,
    redisRuntimeUsesRedis
  } = redisRuntime;

  const defaults = readRedisRuntimeConfig({});
  expect(defaults.url === "redis://127.0.0.1:6379", "default Redis URL points to local Redis");
  expect(defaults.queueDriver === "redis", "default generation queue driver is redis");
  expect(defaults.connectTimeoutMs === 5000, "default Redis connect timeout is 5000ms");

  const inline = readRedisRuntimeConfig({
    GENERATION_QUEUE_DRIVER: "inline",
    REDIS_CONNECT_TIMEOUT_MS: "bad-value"
  });
  expect(inline.queueDriver === "inline", "inline driver is accepted");
  expect(inline.connectTimeoutMs === 5000, "invalid Redis timeout falls back to default");

  const invalid = readRedisRuntimeConfig({
    GENERATION_QUEUE_DRIVER: "unexpected",
    REDIS_URL: "  redis://example.local:6379  ",
    REDIS_CONNECT_TIMEOUT_MS: "2500"
  });
  expect(invalid.queueDriver === "redis", "invalid driver falls back to redis");
  expect(invalid.url === "redis://example.local:6379", "Redis URL is trimmed");
  expect(invalid.connectTimeoutMs === 2500, "valid Redis timeout is accepted");

  expect(redisRuntimeUsesRedis() === false, "runtime honors GENERATION_QUEUE_DRIVER=inline");
  await assertRedisReady();
  expect((await checkRedisHealth()) === "disabled", "inline runtime reports redis disabled");
  await closeRedisClient();
  await closeRedisClient();

  console.log("redis runtime smoke checks passed");
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
