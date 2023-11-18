import wretch, { Wretch } from "npm:wretch@2.7.0";

import { CacheManager } from "./Cache.ts";
import { API_KEY } from "./consts.ts";
import { v1 } from "https://deno.land/std@0.206.0/uuid/mod.ts";

export class ApiClient {
  private apiClient: Wretch;
  private cacheManager: CacheManager;

  constructor() {
    this.apiClient = wretch("https://ontap.pl/api/v1").headers({
      "api-key": API_KEY,
      "device-id": v1.generate().toString(),
    });

    this.cacheManager = CacheManager.getInstance();
  }

  public get = async <T>(url: string) => {
    const cachedValue = await this.cacheManager.get<T>(url);

    if (cachedValue) {
      return cachedValue;
    }

    const apiResponse = await this.apiClient.url(url).get().json<T>();

    await this.cacheManager.set<T>(url, apiResponse);
    return apiResponse;
  };
}
