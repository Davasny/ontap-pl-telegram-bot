import {
  BeerFilterResult2,
  BeerFilterResultSortBy,
  BeersFilters,
  BeerWithTaps,
  City,
  Pub,
  Tap,
  TapParsed,
  TapWithPub,
} from "../types/types";
import { ALCOHOL_DESTINY_G_ML, LRU_CACHE_TTL } from "../consts";
import wretch, { Wretch } from "wretch";
import { WretchLruMiddleware } from "../cache/wretch-lru-middleware";
import "dotenv/config";
import { getSimpleBeer } from "./get-simple-beer";
import { getHalfLiterPrice } from "./get-half-liter-price";
import { normalizeSearchText } from "./normalize-search-text";

const summarizePub = (pub: Pub) => ({
  id: pub.id,
  name: pub.name,
  address: pub.address,
});
const mapsUrl = (pub: Pub) =>
  `https://www.google.com/maps/search/?${new URLSearchParams({
    api: "1",
    query: `${pub.lat},${pub.lon}`,
  })}`;

export class OntapService {
  private static instance: OntapService;
  private onTapApiClient: Wretch;

  constructor() {
    const onTapApiKey = process.env.ONTAP_API_KEY;
    if (!onTapApiKey) throw new Error("ONTAP_API_KEY env variable not set");

    this.onTapApiClient = wretch("https://ontap.pl/api/v1")
      .headers({ "api-key": onTapApiKey })
      .middlewares([WretchLruMiddleware({ ttl: LRU_CACHE_TTL, max: 1000 })]);
  }

  public static getInstance(): OntapService {
    if (!OntapService.instance) OntapService.instance = new OntapService();
    return OntapService.instance;
  }

  public static parseAbv = (abv: string | null | undefined): number | null => {
    if (!abv) return null;
    const value = parseFloat(
      abv.replace(",", ".").replace("%", "").replace("<", ""),
    );
    return Number.isFinite(value) ? value : null;
  };

  public async getCities(): Promise<City[]> {
    return this.onTapApiClient.url("/cities").get().json<City[]>();
  }

  public async getCitiesNames(): Promise<string[]> {
    return (await this.getCities()).map((city) => city.name);
  }

  private async getPubsInCity(cityName: string): Promise<Pub[]> {
    const cities = await this.getCities();
    const city = cities.find(
      (item) =>
        normalizeSearchText(item.name) === normalizeSearchText(cityName),
    );
    if (!city) throw new Error(`City ${cityName} not found`);
    return this.onTapApiClient
      .url(`/cities/${city.id}/pubs`)
      .get()
      .json<Pub[]>();
  }

  public async findPubs(cityName: string, query: string) {
    const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    const pubs = (await this.getPubsInCity(cityName))
      .filter((pub) => {
        const text = normalizeSearchText(`${pub.name} ${pub.address}`);
        return tokens.every((token) => text.includes(token));
      })
      .map(summarizePub);
    return { status: pubs.length ? "ok" : "pub_not_found", pubs };
  }

  public async getPubDetails(cityName: string, pubId: string) {
    const pubs = await this.getPubsInCity(cityName);
    const pub = pubs.find((item) => item.id === pubId);
    if (!pub) return { status: "pub_not_found", pub: null };
    return {
      status: "ok",
      pub: {
        ...summarizePub(pub),
        city: pub.city,
        url: pub.url,
        mapsUrl: mapsUrl(pub),
        activeTaps: pub.active_taps_count,
      },
    };
  }

  public async getTapsInPub(pubId: string): Promise<TapParsed[]> {
    const taps = await this.onTapApiClient
      .url(`/pubs/${pubId}/taps`)
      .get()
      .json<Tap[]>();
    return taps.map((tap) => ({
      ...tap,
      beer: tap.beer
        ? { ...tap.beer, abv: OntapService.parseAbv(tap.beer.abv) }
        : null,
    }));
  }

  public async getPubBeers(
    cityName: string,
    pubId: string,
    filter: Omit<BeersFilters, "cityName" | "limitBeers" | "pubId">,
    sort: BeerFilterResultSortBy,
    limitBeers: number,
  ): Promise<BeerFilterResult2> {
    return this.getBeers({ ...filter, cityName, pubId, limitBeers }, sort);
  }

  public getBeers = async (
    filter: BeersFilters,
    sort: BeerFilterResultSortBy,
  ): Promise<BeerFilterResult2> => {
    if (
      !Number.isInteger(filter.limitBeers) ||
      filter.limitBeers < 1 ||
      filter.limitBeers > 100
    ) {
      throw new Error("limitBeers must be an integer between 1 and 100");
    }
    if (
      filter.priceFrom !== undefined &&
      filter.priceTo !== undefined &&
      filter.priceFrom > filter.priceTo
    ) {
      throw new Error("priceFrom cannot exceed priceTo");
    }
    if (
      filter.abvFrom !== undefined &&
      filter.abvTo !== undefined &&
      filter.abvFrom > filter.abvTo
    ) {
      throw new Error("abvFrom cannot exceed abvTo");
    }

    const styleRegex = filter.lowerCaseStyleRegex
      ? new RegExp(filter.lowerCaseStyleRegex, "i")
      : null;
    const nameRegex = filter.lowerCaseBeerNameRegex
      ? new RegExp(filter.lowerCaseBeerNameRegex, "i")
      : null;
    const pubsInCity = await this.getPubsInCity(filter.cityName);
    const selectedPubs = pubsInCity.filter(
      (pub) => !filter.pubId || pub.id === filter.pubId,
    );
    const pubsWithTaps = await Promise.all(
      selectedPubs.map(async (pub) => ({
        pub,
        taps: await this.getTapsInPub(pub.id),
      })),
    );
    const beerMap = new Map<string, BeerWithTaps>();
    let activeTaps = 0;

    for (const { pub, taps } of pubsWithTaps) {
      for (const tap of taps) {
        if (!tap.beer) continue;
        activeTaps++;
        const beer = tap.beer;
        if (styleRegex && !styleRegex.test(beer.style || "")) continue;
        if (nameRegex && !nameRegex.test(beer.name)) continue;
        if (
          filter.abvFrom !== undefined &&
          (beer.abv === null || beer.abv < filter.abvFrom)
        )
          continue;
        if (
          filter.abvTo !== undefined &&
          (beer.abv === null || beer.abv > filter.abvTo)
        )
          continue;

        const halfLiterPrice = getHalfLiterPrice(tap);
        if (
          filter.priceFrom !== undefined &&
          (halfLiterPrice === null || halfLiterPrice < filter.priceFrom)
        )
          continue;
        if (
          filter.priceTo !== undefined &&
          (halfLiterPrice === null || halfLiterPrice > filter.priceTo)
        )
          continue;

        const halfLiterAlcoholWeight =
          beer.abv === null
            ? null
            : (beer.abv / 100) * 500 * ALCOHOL_DESTINY_G_ML;
        const tapWithPub: TapWithPub = {
          ...tap,
          pub,
          halfLiterPrice,
          halfLiterAlcoholWeight,
          alcoholToPriceRatio:
            halfLiterPrice !== null &&
            halfLiterPrice > 0 &&
            halfLiterAlcoholWeight !== null
              ? halfLiterAlcoholWeight / halfLiterPrice
              : null,
        };
        const existing = beerMap.get(beer.id);
        if (existing) existing.taps.push(tapWithPub);
        else beerMap.set(beer.id, { ...beer, taps: [tapWithPub] });
      }
    }

    const metric = (beer: BeerWithTaps): number | null => {
      if (sort === "alcoholAbvAsc" || sort === "alcoholAbvDesc")
        return beer.abv;
      const values = beer.taps.flatMap((tap) => {
        const value =
          sort === "priceAsc" || sort === "priceDesc"
            ? tap.halfLiterPrice
            : tap.alcoholToPriceRatio;
        return value === null ? [] : [value];
      });
      if (!values.length) return null;
      return sort === "alcoholToPriceRatioAsc" ||
        sort === "alcoholToPriceRatioDesc"
        ? Math.max(...values)
        : Math.min(...values);
    };
    const descending = sort.endsWith("Desc");
    const beers = Array.from(beerMap.values()).sort((a, b) => {
      const left = metric(a);
      const right = metric(b);
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return descending ? right - left : left - right;
    });
    const results = beers.slice(0, filter.limitBeers).map(getSimpleBeer);
    const resultPubIds = new Set(
      results.flatMap((beer) => beer.pubs.map((pub) => pub.pubId)),
    );

    return {
      status: !selectedPubs.length
        ? "pub_not_found"
        : !activeTaps
          ? "no_active_taps"
          : !beers.length
            ? "no_matching_beers"
            : "ok",
      currency: "PLN",
      priceBasis: "normalized_0.5l",
      pubs: selectedPubs
        .filter((pub) => !results.length || resultPubIds.has(pub.id))
        .map(summarizePub),
      total: beers.length,
      returned: results.length,
      truncated: beers.length > results.length,
      beers: results,
    };
  };
}
