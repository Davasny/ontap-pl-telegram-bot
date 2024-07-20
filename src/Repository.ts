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
  PubWithTaps,
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

  // todo: simplify pub details
  // todo: simplify taps details
  public async getPubDetails(
    cityName: string,
    pubName: string,
  ): Promise<PubWithTaps> {
    const pub = await this.getPubsInCityFull(cityName).then((pubs) =>
      pubs.find((pub) => pub.name === pubName),
    );

    if (!pub) {
      throw new Error(`Pub "${pubName}" not found`);
    }

    const beers = await this.getBeers({
      cityName: cityName,
      pubNameRegex: pub.name.toLowerCase(),
      limitBeers: 100,
    });

    return {
      ...pub,
      beers: beers.beers,
    };
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

  private static parseAbv = (abv: string | null | undefined): number | null => {
    if (!abv) {
      return null;
    }

    const abvNumber = parseFloat(abv.replace(",", ".").replace("%", ""));
    if (isNaN(abvNumber)) {
      return null;
    }

    return abvNumber;
  };

  private static getAlcoholWeight = (tap: Tap): number | null => {
    const abv = this.parseAbv(tap.beer?.abv);
    if (!abv) {
      return null;
    }

    return Math.round((abv / 100) * 500 * ALCOHOL_DESTINY_G_ML);
  };

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

  // todo: handle sorting
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

    const filteredPubsByName = pubsWithTapsInCity.filter(
      (pub) =>
        !filter.pubNameRegex ||
        new RegExp(filter.pubNameRegex).test(pub.pub.name.toLowerCase()),
    );

    for (const pubWithTaps of filteredPubsByName) {
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

    const filterByLowerAbv = (beer: BeerWithTaps): boolean =>
      !filter.abvFrom ||
      (beer.abv && filter.abvFrom
        ? parseFloat(beer.abv) >= (filter.abvFrom ? filter.abvFrom : 9999)
        : false);

    const filterByHigherAbv = (beer: BeerWithTaps): boolean =>
      !filter.abvTo ||
      (beer.abv && filter.abvTo
        ? parseFloat(beer.abv) <= (filter.abvTo ? filter.abvTo : 0)
        : false);

    const filteredBeers = beers
      .filter(filterByStyleRegex)
      .filter(filterByLowerPrice)
      .filter(filterByHigherPrice)
      .filter(filterByLowerAbv)
      .filter(filterByHigherAbv);

    const simplifiedBeers: BeerFilterResult[] = filteredBeers.map((beer) => {
      const pubs: BeerFilterResultPub[] = beer.taps.map((tap) => ({
        pubName: tap.pub.name,
        halfLiterPrice: tap.halfLiterPrice,
      }));

      return {
        pubs: pubs,
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

  public simplifyGetBeersOutput = (beers: BeerFilterResult2): string => {
    const uniquePubs = new Set<string>();
    for (const beer of beers.beers) {
      for (const pub of beer.pubs) {
        uniquePubs.add(pub.pubName);
      }
    }

    const SEPARATOR = " ";

    const uniquePubsArray = Array.from(uniquePubs);

    const fields = [
      { headerName: "name", filedName: "beerName" },
      { headerName: "style", filedName: "beerStyle" },
      { headerName: "abv", filedName: "abv" },
    ];

    let text = "";

    let pubsHeader = "";
    if (uniquePubsArray.length === 1) {
      text = text + `Pub:${uniquePubsArray[0]}\n`;
    } else {
      // todo: handle pubs mapping
      pubsHeader = `${SEPARATOR}pubs-price zł`;
    }

    text =
      text +
      fields.map((field) => field.headerName).join(SEPARATOR) +
      pubsHeader +
      "\n";

    for (const beer of beers.beers) {
      let pubs = "";
      if (uniquePubsArray.length > 1) {
        pubs = beer.pubs
          .map((pub) => {
            let price = "--";
            if (pub.halfLiterPrice) {
              price = `-${pub.halfLiterPrice}`;
            }

            return `${pub.pubName}${price}`;
          })
          .join(",");
      }

      text =
        text +
        fields
          .map((field) => beer[field.filedName as keyof BeerFilterResult])
          .map((field) => {
            if (typeof field === "string") {
              return field.trim();
            }
            return "";
          })
          .join(SEPARATOR) +
        `${SEPARATOR}${pubs}` +
        "\n";
    }

    return text;
  };
}
