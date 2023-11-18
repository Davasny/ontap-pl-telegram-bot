import "https://deno.land/std@0.207.0/dotenv/load.ts";

export const API_KEY = Deno.env.get("ONTAP_API_KEY");
export const KV_CACHE_EXPIRE_MS = 60_000 * 60;

// https://pl.wikipedia.org/wiki/Etanol
export const ALCOHOL_DESTINY_G_ML = 0.789;
