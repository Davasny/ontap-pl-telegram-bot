import { ApiClient } from "./ApiClient";
import {
  Beer,
  BeerFilterResult,
  BeerFilterResult2,
  BeerFilterResultPub,
  BeerId,
  BeersFilters,
  BeerWithTaps,
  City,
  Pub,
  Tap,
  TapWithPub,
} from "./types";
import { CacheManager } from "./CacheManager";
import { ALCOHOL_DESTINY_G_ML } from "./consts";

export class Repository {
  private static instance: Repository;

  private apiClient: ApiClient;
  private cacheManager: CacheManager;

  constructor() {
    this.apiClient = new ApiClient();
    this.cacheManager = CacheManager.getInstance();
  }

  public static getInstance(): Repository {
    if (!Repository.instance) {
      Repository.instance = new Repository();
    }

    return Repository.instance;
  }

  public async getCities(): Promise<City[]> {
    return await this.apiClient.get<City[]>("/cities");
  }

  public async getCitiesNames(): Promise<string[]> {
    return await this.apiClient
      .get<City[]>("/cities")
      .then((cities) => cities.map((city) => city.name));
  }

  private async getPubsInCityFull(cityName: string): Promise<Pub[]> {
    const city = await this.getCities().then((cities) =>
      cities.find((city) => city.name === cityName),
    );

    if (!city) {
      throw new Error(`City ${cityName} not found`);
    }

    return await this.apiClient.get<Pub[]>(`/cities/${city.id}/pubs`);
  }

  public async getPubsInCity(cityName: string): Promise<string[]> {
    const pubs = await this.getPubsInCityFull(cityName);

    return pubs.map((pub) => pub.name);
  }

  public async getPubDetails(cityName: string, pubName: string): Promise<Pub> {
    const pub = await this.getPubsInCityFull(cityName).then((pubs) =>
      pubs.find((pub) => pub.name === pubName),
    );

    if (!pub) {
      throw new Error(`Pub "${pubName}" not found`);
    }

    return pub;
  }

  public async getPubByName(cityName: string, pubName: string): Promise<Pub> {
    const pub = await this.getPubsInCityFull(cityName).then((pubs) =>
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

  public getGoogleMapsUrl = async (
    cityName: string,
    pubName: string,
  ): Promise<string> => {
    const pub = await this.getPubByName(cityName, pubName);
    const urlParams = new URLSearchParams({
      api: "1",
      destination: `${pub.lat},${pub.lon}`,
    });

    return `https://www.google.com/maps/dir/?${urlParams.toString()}`;
  };

  public getBeers = async (
    filter: BeersFilters,
  ): Promise<BeerFilterResult2> => {
    const pubsInCity = await this.getPubsInCityFull(filter.cityName);

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

    const filterByLowerPrice = (beer: BeerWithTaps): boolean =>
      !filter.priceFrom ||
      (filter.priceFrom
        ? beer.taps.some((tap) =>
            tap.halfLiterPrice
              ? tap.halfLiterPrice >=
                (filter.priceFrom ? filter.priceFrom : 9999)
              : false,
          )
        : false);

    const filterByHigherPrice = (beer: BeerWithTaps): boolean =>
      !filter.priceTo ||
      (filter.priceTo
        ? beer.taps.some((tap) =>
            tap.halfLiterPrice
              ? tap.halfLiterPrice <= (filter.priceTo ? filter.priceTo : 0)
              : false,
          )
        : false);

    const filteredBeers = beers
      .filter(filterByStyleRegex)
      .filter(filterByPubName)
      .filter(filterByLowerPrice)
      .filter(filterByHigherPrice);

    const simplifiedBeers: BeerFilterResult[] = filteredBeers.map((beer) => {
      const pubsNames: BeerFilterResultPub[] = beer.taps.map((tap) => ({
        pubName: tap.pub.name,
        halfLiterPrice: tap.halfLiterPrice,
      }));

      return {
        pubs: pubsNames,
        beerId: beer.id,
        beerName: beer.name,
        beerStyle: beer.style,
        abv: beer.abv,
      };
    });

    return {
      beers: simplifiedBeers.slice(0, filter.limitBeers),
      total: filteredBeers.length,
    };
  };
}
