import { CacheManager } from "./CacheManager";
import { API_KEY } from "./consts";
import wretch, { Wretch } from "wretch";

export class ApiClient {
  private apiClient: Wretch;
  private cacheManager: CacheManager;

  constructor() {
    this.apiClient = wretch("https://ontap.pl/api/v1").headers({
      "api-key": API_KEY,
    });

    this.cacheManager = CacheManager.getInstance();
  }

  public get = async <T>(url: string) => {
    const cachedValue = await this.cacheManager.get<T>(url);

    if (cachedValue) {
      return cachedValue;
    }

    console.log("[AC] fetch", url);
    const apiResponse = await this.apiClient.url(url).get().json<T>();

    await this.cacheManager.set<T>(url, apiResponse);
    return apiResponse;
  };
}
