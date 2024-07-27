import {
  BeerFilterResult,
  BeerFilterResult2,
  BeerFilterResultSortBy,
  BeerId,
  BeersFilters,
  BeerWithTaps,
  City,
  Pub,
  PubWithTaps,
  Tap,
  TapParsed,
  TapWithPub,
} from "../types/types";
import { ALCOHOL_DESTINY_G_ML, LRU_CACHE_TTL } from "../consts";
import wretch, { Wretch } from "wretch";
import { WretchLruMiddleware } from "../cache/WretchLruMiddleware";
import "dotenv/config";
import { getSimpleBeer } from "./getSimpleBeer";

export class OnTapService {
  private static instance: OnTapService;

  private onTapApiClient: Wretch;

  constructor() {
    const onTapApiKey = process.env.ONTAP_API_KEY;
    if (!onTapApiKey) {
      throw new Error("ONTAP_API_KEY env variable not set");
    }

    this.onTapApiClient = wretch("https://ontap.pl/api/v1")
      .headers({
        "api-key": onTapApiKey,
      })
      .middlewares([
        WretchLruMiddleware({
          ttl: LRU_CACHE_TTL,
          max: 1000,
        }),
      ]);
  }

  public static getInstance(): OnTapService {
    if (!OnTapService.instance) {
      OnTapService.instance = new OnTapService();
    }

    return OnTapService.instance;
  }

  private static getHalfLiterPrice = (tap: TapParsed): number | null => {
    const halfLiterVariant = tap.variants.find((v) => v.volume === "0.5l");
    if (halfLiterVariant) {
      return Math.round(halfLiterVariant.price / 100);
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
      return Math.round((0.5 * price) / volumeNumber);
    }

    return null;
  };

  public static parseAbv = (abv: string | null | undefined): number | null => {
    if (!abv) {
      return null;
    }

    const abvNumber = parseFloat(
      abv.replace(",", ".").replace("%", "").replace("<", ""),
    );
    if (isNaN(abvNumber)) {
      return null;
    }

    return abvNumber;
  };

  private static getAlcoholWeight = (tap: TapParsed): number | null => {
    const abv = tap.beer?.abv;
    if (!abv) {
      return null;
    }

    return Math.round((abv / 100) * 500 * ALCOHOL_DESTINY_G_ML);
  };

  public async getCities(): Promise<City[]> {
    return await this.onTapApiClient.url("/cities").get().json<City[]>();
  }

  public async getCitiesNames(): Promise<string[]> {
    return await this.onTapApiClient
      .url("/cities")
      .get()
      .json<City[]>()
      .then((cities) => cities.map((city) => city.name));
  }

  private async getPubsInCity(cityName: string): Promise<Pub[]> {
    const city = await this.getCities().then((cities) =>
      cities.find((city) => city.name === cityName),
    );

    if (!city) {
      throw new Error(`City ${cityName} not found`);
    }

    return await this.onTapApiClient
      .url(`/cities/${city.id}/pubs`)
      .get()
      .json<Pub[]>();
  }

  public async getPubNamesInCity(cityName: string): Promise<string[]> {
    const pubs = await this.getPubsInCity(cityName);

    return pubs.map((pub) => pub.name);
  }

  public async getPubDetails(
    cityName: string,
    pubName: string,
  ): Promise<PubWithTaps> {
    const pub = await this.getPubsInCity(cityName).then((pubs) =>
      pubs.find((pub) => pub.name === pubName),
    );

    if (!pub) {
      throw new Error(`Pub "${pubName}" not found`);
    }

    const beers = await this.getBeers(
      {
        cityName: cityName,
        pubNameRegex: pub.name.toLowerCase(),
        limitBeers: 100,
      },
      "priceAsc",
    );

    return {
      ...pub,
      beers: beers.beers,
    };
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

  public async getTapsInPub(pubId: string): Promise<TapParsed[]> {
    // parse abv to number
    return await this.onTapApiClient
      .url(`/pubs/${pubId}/taps`)
      .get()
      .json<Tap[]>()
      .then((taps) =>
        taps.map((tap) => ({
          ...tap,
          beer: tap.beer
            ? {
                ...tap.beer,
                abv: OnTapService.parseAbv(tap.beer.abv),
              }
            : tap.beer,
        })),
      );
  }

  public getGoogleMapsUrl = async (
    cityName: string,
    pubName: string,
  ): Promise<string> => {
    const pub = await this.getPubByName(cityName, pubName);
    const urlParams = new URLSearchParams({
      api: "1",
      query: `${pub.lat},${pub.lon}`,
    });

    return `https://www.google.com/maps/search/?${urlParams.toString()}`;
  };

  public getBeers = async (
    filter: BeersFilters,
    sort: BeerFilterResultSortBy,
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

    const filteredPubsByName = pubsWithTapsInCity.filter(
      (pub) =>
        !filter.pubNameRegex ||
        new RegExp(filter.pubNameRegex).test(pub.pub.name.toLowerCase()),
    );

    for (const pubWithTaps of filteredPubsByName) {
      for (const tap of pubWithTaps.taps) {
        const halfLiterPrice = OnTapService.getHalfLiterPrice(tap);
        const halfLiterAlcoholWeight = OnTapService.getAlcoholWeight(tap);
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

    const filterByBeerNameRegex = (beer: BeerWithTaps): boolean =>
      !filter.lowerCaseBeerNameRegex ||
      (beer.name
        ? new RegExp(filter.lowerCaseBeerNameRegex).test(
            beer.name.toLowerCase(),
          )
        : false);

    const filterByLowerPrice = (beer: BeerWithTaps): boolean =>
      filter.priceFrom === undefined ||
      (filter.priceFrom
        ? beer.taps.some((tap) =>
            tap.halfLiterPrice
              ? tap.halfLiterPrice >=
                (filter.priceFrom ? filter.priceFrom : 9999)
              : false,
          )
        : false);

    const filterByHigherPrice = (beer: BeerWithTaps): boolean =>
      filter.priceTo === undefined ||
      (filter.priceTo
        ? beer.taps.some((tap) =>
            tap.halfLiterPrice
              ? tap.halfLiterPrice <= (filter.priceTo ? filter.priceTo : 0)
              : false,
          )
        : false);

    const filterByLowerAbv = (beer: BeerWithTaps): boolean =>
      filter.abvFrom === undefined ||
      (beer.abv !== null ? beer.abv >= filter.abvFrom : false);

    const filterByHigherAbv = (beer: BeerWithTaps): boolean =>
      filter.abvTo === undefined ||
      (beer.abv !== null ? beer.abv <= filter.abvTo : false);

    const filteredBeers = beers
      .filter(filterByStyleRegex)
      .filter(filterByLowerPrice)
      .filter(filterByHigherPrice)
      .filter(filterByLowerAbv)
      .filter(filterByHigherAbv)
      .filter(filterByBeerNameRegex);

    let sortedBeers = [];
    switch (sort) {
      case "alcoholAbvAsc":
        sortedBeers = filteredBeers.sort(
          (a, b) => (a.abv && b.abv && a.abv - b.abv) || 0,
        );
        break;
      case "alcoholAbvDesc":
        sortedBeers = filteredBeers.sort(
          (a, b) => (b.abv && a.abv && b.abv - a.abv) || 0,
        );
        break;
      case "alcoholToPriceRatioAsc":
        sortedBeers = filteredBeers.sort(
          (a, b) =>
            (a.taps[0].alcoholToPriceRatio &&
              b.taps[0].alcoholToPriceRatio &&
              a.taps[0].alcoholToPriceRatio - b.taps[0].alcoholToPriceRatio) ||
            0,
        );
        break;
      case "alcoholToPriceRatioDesc":
        sortedBeers = filteredBeers.sort(
          (a, b) =>
            (b.taps[0].alcoholToPriceRatio &&
              a.taps[0].alcoholToPriceRatio &&
              b.taps[0].alcoholToPriceRatio - a.taps[0].alcoholToPriceRatio) ||
            0,
        );
        break;
      case "priceAsc":
        sortedBeers = filteredBeers.sort(
          (a, b) =>
            (a.taps[0].halfLiterPrice &&
              b.taps[0].halfLiterPrice &&
              a.taps[0].halfLiterPrice - b.taps[0].halfLiterPrice) ||
            0,
        );
        break;
      case "priceDesc":
        sortedBeers = filteredBeers.sort(
          (a, b) =>
            (b.taps[0].halfLiterPrice &&
              a.taps[0].halfLiterPrice &&
              b.taps[0].halfLiterPrice - a.taps[0].halfLiterPrice) ||
            0,
        );
        break;
    }

    const simplifiedBeers: BeerFilterResult[] = sortedBeers.map(getSimpleBeer);

    return {
      beers: simplifiedBeers.slice(0, filter.limitBeers),
    };
  };
}
