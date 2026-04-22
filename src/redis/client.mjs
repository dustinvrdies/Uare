let sharedClientPromise = null;

export async function getRedisClient(runtime = {}) {
  const url = runtime.redisUrl || runtime.eventBusRedisUrl || runtime.rateLimitRedisUrl || '';
  if (!url) throw new Error('Redis URL is required');
  if (!sharedClientPromise) {
    sharedClientPromise = import('redis').then(async ({ createClient }) => {
      const client = createClient({
        url,
        socket: {
          reconnectStrategy(retries) {
            return Math.min(retries * 100, 3000);
          },
        },
      });
      client.on('error', () => {});
      await client.connect();
      return client;
    }).catch((error) => {
      sharedClientPromise = null;
      throw error;
    });
  }
  return sharedClientPromise;
}

export async function closeRedisClient() {
  if (!sharedClientPromise) return;
  try {
    const client = await sharedClientPromise;
    await client.quit();
  } catch {
    try {
      const client = await sharedClientPromise;
      client.disconnect();
    } catch {}
  } finally {
    sharedClientPromise = null;
  }
}
