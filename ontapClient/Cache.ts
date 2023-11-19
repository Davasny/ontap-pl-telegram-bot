import { MemoryCache } from "./MemoryCache";
import { KeyvCache } from "./KeyvCache";

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;

  set<T>(key: string, value: T): Promise<void>;

  listKeys<T>(): Promise<string[]>;
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
        new KeyvCache(),
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
