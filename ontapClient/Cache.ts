import { KV_CACHE_EXPIRE_MS } from "./consts.ts";

export const kv = await Deno.openKv("./deno-kv.db");

interface Cache {
  get<T>(key: string): Promise<T | undefined>;

  set<T>(key: string, value: T): Promise<void>;

  listKeys<T>(): Promise<string[]>;
}

export class KvCache implements Cache {
  public get = async <T>(key: string): Promise<T | undefined> => {
    console.log("[KV] get", key);
    const value = await kv.get([key]);

    if (value.value) {
      return value.value as T;
    }
    return undefined;
  };

  public set = async <T>(key: string, value: T): Promise<void> => {
    console.log("[KV] set", key);
    await kv.set([key], value, { expireIn: KV_CACHE_EXPIRE_MS });
    return;
  };

  public listKeys = async <T>(): Promise<string[]> => {
    console.log("[KV] list");

    const iter = kv.list<string>({ prefix: [] });
    const keys: string[] = [];
    for await (const key of iter) {
      keys.push(key.key.join());
    }

    return keys;
  };
}

export class MemoryCache implements Cache {
  private cache: Map<string, any> = new Map();

  static serializeKey = (key: string[]): string => key.join("-");

  public get = <T>(key: string): Promise<T | undefined> => {
    console.log("[ME] get", key);
    return this.cache.get(key);
  };

  public set = <T>(key: string, value: T): Promise<void> => {
    console.log("[ME] set", key);
    this.cache.set(key, value);
    return new Promise((resolve) => resolve());
  };

  public listKeys = <T>(): Promise<string[]> => {
    console.log("[ME] list");
    return new Promise((resolve) => resolve(Array.from(this.cache.keys())));
  };
}

export class CacheManager {
  private static instance: CacheManager;

  private readonly caches: Cache[];
  private synchronizeCache: boolean;

  constructor(caches: Cache[], synchronizeCache = true) {
    this.caches = caches;
    this.synchronizeCache = synchronizeCache;
  }

  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager([
        new MemoryCache(),
        new KvCache(),
      ]);
    }

    return CacheManager.instance;
  }

  public get = async <T>(key: string): Promise<T | undefined> => {
    const cachesToSync: Cache[] = [];

    let value: T | undefined = undefined;
    for (const cache of this.caches) {
      value = await cache.get<T>(key);

      if (value) {
        break;
      }

      cachesToSync.push(cache);
    }

    if (value) {
      if (this.synchronizeCache) {
        for (const cache of cachesToSync) {
          await cache.set<T>(key, value);
        }
      }
      return value;
    }

    return undefined;
  };

  public set = <T>(key: string, value: T): Promise<void> => {
    return new Promise((resolve) => {
      const promises = this.caches.map((cache) => cache.set<T>(key, value));
      Promise.all(promises).then(() => resolve());
    });
  };

  public listKeys = async (): Promise<string[]> => {
    const keys: string[][] = await Promise.all(
      this.caches.map((cache) => cache.listKeys()),
    );

    return keys.flat();
  };
}
