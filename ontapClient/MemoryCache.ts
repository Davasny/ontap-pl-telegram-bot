import { Cache } from "./Cache";

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
