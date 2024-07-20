import {
  ConfiguredMiddleware,
  FetchLike,
  WretchOptions,
  WretchResponse,
} from "wretch";

import { LRUCache } from "lru-cache";

export const lruCache = (
  lruOptions: LRUCache.Options<string, WretchResponse, unknown>,
): ConfiguredMiddleware => {
  const cache = new LRUCache<string, WretchResponse>(lruOptions);

  const middleware = (next: FetchLike): FetchLike => {
    const checkCache = async (
      url: string,
      opts: WretchOptions,
    ): Promise<WretchResponse> => {
      const cachedResponse = cache.get(url);
      if (cachedResponse) {
        return cachedResponse.clone();
      }

      console.log("Cache miss", url);

      const response = await next(url, opts);
      if (response.ok) {
        cache.set(url, response.clone());
      }

      return response;
    };

    return checkCache;
  };

  return middleware;
};
