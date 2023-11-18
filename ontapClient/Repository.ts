import { ApiClient } from "./ApiClient.ts";
import {
  Beer,
  BeerFilterResult2,
  BeerId,
  BeersFilters,
  BeerWithTaps,
  City,
  Pub,
  Tap,
  TapWithPub,
} from "./types.ts";
import { CacheManager } from "./Cache.ts";
import { ALCOHOL_DESTINY_G_ML } from "./consts.ts";

export class Repository {
  private apiClient: ApiClient;
  private cacheManager: CacheManager;

  constructor() {
    this.apiClient = new ApiClient();
    this.cacheManager = CacheManager.getInstance();
  }

  public async getCities(): Promise<City[]> {
    return await this.apiClient.get<City[]>("/cities");
  }

  public async getPubsInCity(cityName: string): Promise<Pub[]> {
    const city = await this.getCities().then((cities) =>
      cities.find((city) => city.name === cityName),
    );

    if (!city) {
      throw new Error(`City ${cityName} not found`);
    }

    return await this.apiClient.get<Pub[]>(`/cities/${city.id}/pubs`);
  }

  public async getPubDetails(cityName: string, pubId: string): Promise<Pub> {
    const pub = await this.getPubsInCity(cityName).then((pubs) =>
      pubs.find((pub) => pub.id === pubId),
    );

    if (!pub) {
      throw new Error(`Pub ${pubId} not found`);
    }

    return pub;
  }

  public async getPubByName(cityName: string, pubName: string): Promise<Pub> {
    const pub = await this.getPubsInCity(cityName).then((pubs) =>
      pubs.find((pub) => pub.name === pubName),
    );

    if (!pub) {
      throw new Error(`Pub ${pubName} not found`);
    }

    return pub;
  }

  private static getBeerCacheKey = (beer: Beer): string => `beer-${beer.id}`;

  public async getTapsInPub(pubId: string): Promise<Tap[]> {
    const taps = await this.apiClient.get<Tap[]>(`/pubs/${pubId}/taps`);

    const cachedBeers: string[] = await this.cacheManager.listKeys();

    for (const tap of taps) {
      if (
        tap.beer &&
        !cachedBeers.includes(Repository.getBeerCacheKey(tap.beer))
      ) {
        await this.cacheManager.set(
          Repository.getBeerCacheKey(tap.beer),
          tap.beer,
        );
      }
    }

    return taps;
  }

  public getBeerDetails = async (beerId: string): Promise<Beer> => {
    const beer = await this.cacheManager.get<Beer>(`beer-${beerId}`);
    if (!beer) {
      throw new Error(`Beer ${beerId} not found`);
    }

    return beer;
  };

  private static getHalfLiterPrice = (tap: Tap): number | null => {
    const halfLiterVariant = tap.variants.find((v) => v.volume === "0.5l");
    if (halfLiterVariant) {
      return halfLiterVariant.price / 100;
    }

    // if there is no 0.5l variant, try to calculate it from other variants
    if (tap.variants.length > 0) {
      const volume = tap.variants[0].volume;
      // get number from volume string "0.5l" -> 0.5
      const volumeNumber = parseFloat(
        volume.replace(",", ".").replace("l", ""),
      );
      const price = tap.variants[0].price / 100;
      // normalize price to 0.5l
      return (0.5 * price) / volumeNumber;
    }

    return null;
  };

  private static getAlcoholWeight = (tap: Tap): number | null => {
    const abv = tap.beer?.abv;
    if (!abv) {
      return null;
    }

    return (abv / 100) * 500 * ALCOHOL_DESTINY_G_ML;
  };

  public getBeers = async (
    filter: BeersFilters,
  ): Promise<BeerFilterResult2> => {
    const pubsInCity = await this.getPubsInCity(filter.cityName);

    const pubsWithTapsInCity = (
      await Promise.all(
        pubsInCity.map((pub) =>
          this.getTapsInPub(pub.id).then((taps) => ({ pub: pub, taps: taps })),
        ),
      )
    ).flat();

    const beersInCityMap = new Map<BeerId, BeerWithTaps>();

    for (const pubWithTaps of pubsWithTapsInCity) {
      for (const tap of pubWithTaps.taps) {
        const halfLiterPrice = Repository.getHalfLiterPrice(tap);
        const halfLiterAlcoholWeight = Repository.getAlcoholWeight(tap);
        const alcoholToPriceRatio =
          halfLiterAlcoholWeight && halfLiterPrice
            ? halfLiterAlcoholWeight / halfLiterPrice
            : null;

        const tapWithPub: TapWithPub = {
          ...tap,
          pub: pubWithTaps.pub,
          halfLiterPrice,
          halfLiterAlcoholWeight,
          alcoholToPriceRatio,
        };

        if (tap.beer) {
          const beer = beersInCityMap.get(tap.beer.id);
          if (beer) {
            beer.taps.push(tapWithPub);
          } else {
            const beerWithTaps: BeerWithTaps = {
              ...tap.beer,
              taps: [tapWithPub],
            };

            beersInCityMap.set(tap.beer.id, beerWithTaps);
          }
        }
      }
    }

    const beers: BeerWithTaps[] = Array.from(beersInCityMap.values());

    const filterByStyleRegex = (beer: BeerWithTaps): boolean =>
      !filter.lowerCaseStyleRegex ||
      (beer.style
        ? new RegExp(filter.lowerCaseStyleRegex).test(beer.style.toLowerCase())
        : false);

    const filterByPubName = (beer: BeerWithTaps): boolean =>
      !filter.pubName ||
      beer.taps.some((tap) => tap.pub.name === filter.pubName);

    const filterByPubId = (beer: BeerWithTaps): boolean =>
      !filter.pubId || beer.taps.some((tap) => tap.pub.id === filter.pubId);

    const filterByLowerPrice = (beer: BeerWithTaps): boolean =>
      !filter.priceFrom ||
      (filter.priceFrom
        ? beer.taps.some((tap) =>
            tap.halfLiterPrice
              ? tap.halfLiterPrice >= (filter.priceFrom ? filter.priceFrom : 0)
              : false,
          )
        : false);

    const filterByHigherPrice = (beer: BeerWithTaps): boolean =>
      !filter.priceTo ||
      (filter.priceTo
        ? beer.taps.some((tap) =>
            tap.halfLiterPrice
              ? tap.halfLiterPrice <= (filter.priceFrom ? filter.priceFrom : 0)
              : false,
          )
        : false);

    const filteredBeers = beers
      .filter(filterByStyleRegex)
      .filter(filterByPubName)
      .filter(filterByLowerPrice)
      .filter(filterByHigherPrice)
      .filter(filterByPubId);

    return {
      beers: filteredBeers.slice(0, filter.limitBeers),
      total: filteredBeers.length,
    };
  };
}
