import {
  ConfiguredMiddleware,
  FetchLike,
  WretchOptions,
  WretchResponse,
} from "wretch";

import { LRUCache } from "lru-cache";
import { logger } from "../logger";

export const WretchLruMiddleware = (
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
        logger.debug(`Cache hit for ${url}`);
        return cachedResponse.clone();
      }

      const response = await next(url, opts);
      if (response.ok) {
        logger.debug(`Cache miss for ${url}`);
        cache.set(url, response.clone());
      }

      return response;
    };

    return checkCache;
  };

  return middleware;
};
