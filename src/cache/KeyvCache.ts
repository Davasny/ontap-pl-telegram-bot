import Keyv from "keyv";
import { ICache } from "./CacheManager";

const keyv = new Keyv("sqlite://./api-cache.sqlite");

export class KeyvCache implements ICache {
  public get = async <T>(key: string): Promise<T | undefined> => {
    const value = await keyv.get(key);

    if (value) {
      return value as T;
    }
    return undefined;
  };

  public set = async <T>(key: string, value: T): Promise<void> => {
    // console.log("[KV] set", key);
    await keyv.set(key, value);
    return;
  };

  public listKeys = async <T>(): Promise<string[]> => {
    // console.log("[KV] list");

    const iter = keyv.iterator();
    const keys: string[] = [];
    for await (const [key, value] of iter) {
      keys.push(key);
    }

    return keys;
  };
}
