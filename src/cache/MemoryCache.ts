import { ICache } from "./CacheManager";

export class MemoryCache implements ICache {
  private cache: Map<string, any> = new Map();

  static serializeKey = (key: string[]): string => key.join("-");

  public get = <T>(key: string): Promise<T | undefined> => {
    return this.cache.get(key);
  };

  public set = <T>(key: string, value: T): Promise<void> => {
    this.cache.set(key, value);
    return new Promise((resolve) => resolve());
  };

  public listKeys = <T>(): Promise<string[]> => {
    // console.log("[ME] list");
    return new Promise((resolve) => resolve(Array.from(this.cache.keys())));
  };
}
