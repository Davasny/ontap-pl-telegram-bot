import { KV_CACHE_EXPIRE_MS } from "./consts.ts";
import { Cache } from "./CacheManager.ts";

export const kv = await Deno.openKv("./deno-kv.db");

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
