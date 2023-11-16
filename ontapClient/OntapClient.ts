import wretch, { Wretch } from "npm:wretch@2.7.0";
import { v1 } from "https://deno.land/std@0.206.0/uuid/mod.ts";

import {
  Beer,
  BeerFilterResult,
  BeerId,
  BeersFilters,
  City,
  CityName,
  Pub,
  PubId,
  Tap,
  TapId,
} from "./types.ts";
import { API_KEY, CACHE_EXPIRE } from "./consts.ts";

const kv = await Deno.openKv("./deno-kv.db");

export class OntapService {
  private static instance: OntapService;
  private apiClient: Wretch;

  private citiesCache: City[] | null = null;
  private pubsByCity: Map<CityName, Pub[]> = new Map();
  private pubs: Map<PubId, Pub> = new Map();
  private taps: Map<TapId, Tap> = new Map();
  private beers: Map<BeerId, Beer> = new Map();

  private constructor() {
    this.apiClient = wretch("https://ontap.pl/api/v1").headers({
      "api-key": API_KEY,
      "device-id": v1.generate().toString(),
    });
  }

  public static getInstance(): OntapService {
    if (!OntapService.instance) {
      OntapService.instance = new OntapService();
    }
    return OntapService.instance;
  }

  private async fetchCities(): Promise<City[]> {
    const url = "/cities";
    const cachedCities = await kv.get(["cache", url]);

    if (cachedCities.value) {
      this.citiesCache = cachedCities.value as City[];
      return this.citiesCache;
    }

    if (!this.citiesCache) {
      this.citiesCache = await this.apiClient.url(url).get().json<City[]>();
      kv.set(["cache", url], this.citiesCache, { expireIn: CACHE_EXPIRE });
    }

    return this.citiesCache;
  }

  private async fetchPubsByCity(cityId: string): Promise<Pub[]> {
    const url = `/cities/${cityId}/pubs`;

    // first check in memory cache
    const memoryPubs = this.pubsByCity.get(cityId);
    if (memoryPubs) {
      return memoryPubs;
    }

    // second check in KV cache
    const kvPubs = await kv.get(["cache", url]);
    if (kvPubs.value) {
      const kvPubsObj = kvPubs.value as Pub[];
      this.pubsByCity.set(cityId, kvPubsObj);
      for (const pub of kvPubsObj) {
        this.pubs.set(pub.id, pub);
      }
    }

    // third fetch from API
    const pubs = await this.apiClient.url(url).get().json<Pub[]>();
    for (const pub of pubs) {
      this.pubs.set(pub.id, pub);
    }

    this.pubsByCity.set(cityId, pubs);
    kv.set(["cache", url], pubs, { expireIn: CACHE_EXPIRE });

    return pubs;
  }

  private async fetchTaps(pubId: string): Promise<Tap[]> {
    const url = `/pubs/${pubId}/taps`;
    const cachedTaps = await kv.get(["cache", url]);

    if (cachedTaps.value) {
      this.taps.set(pubId, cachedTaps.value as Tap[]);
      return this.taps.get(pubId) || [];
    }

    if (!this.taps.has(pubId)) {
      const taps = await this.apiClient
        .url(`/pubs/${pubId}/taps`)
        .get()
        .json<Tap[]>();
      kv.set(["cache", url], taps, { expireIn: CACHE_EXPIRE });
      this.taps.set(pubId, taps);
    }
    return this.taps.get(pubId) || [];
  }

  private addBeer = (beer: Beer) => {
    this.beers.set(beer.id, beer);
    kv.set(["storage", "beer", beer.id], beer);
  };

  public getBeerDetails = async (beerId: string): Promise<Beer | null> => {
    const beer = this.beers.get(beerId);
    if (beer) {
      console.log("Beer from cache");
      return beer;
    }

    const kvBeer = await kv.get(["storage", "beer", beerId]);
    if (kvBeer.value) {
      console.log("Beer from KV");
      this.beers.set(beerId, kvBeer.value as Beer);
      return kvBeer.value as Beer;
    }

    console.log("Beer not found");

    return null;
  };

  public getCities(): Promise<City[]> {
    return this.fetchCities();
  }

  public getCitiesNames(): Promise<string[]> {
    return this.fetchCities().then((cities) => cities.map((city) => city.name));
  }

  public getPubsInCity = async (cityName: string): Promise<Pub[]> => {
    const cityId = this.citiesCache?.find((city) => city.name === cityName)?.id;

    if (cityId) {
      return this.fetchPubsByCity(cityId);
    }

    await this.fetchCities();

    return this.getPubsInCity(cityName);
  };

  public getPubDetails = (pubId: string): Promise<Pub | null> => {
    const pub = this.pubs.get(pubId);
    if (pub) {
      return new Promise((resolve) => resolve(pub));
    }

    return Promise.reject("Pub not found");
  };

  public async getBeerStyles(): Promise<string[]> {
    const cities = await this.fetchCities();
    const beerStyles = new Set<string>();

    for (const city of cities) {
      const pubs = await this.fetchPubsByCity(city.id);
      for (const pub of pubs) {
        const taps = await this.fetchTaps(pub.id);
        taps.forEach((tap) => {
          if (tap.beer && tap.beer.style) {
            beerStyles.add(tap.beer.style);
          }
        });
      }
    }

    return Array.from(beerStyles);
  }

  public async getBeers(filters: BeersFilters): Promise<BeerFilterResult[]> {
    const cities = await this.fetchCities();
    const city = cities.find(
      (city) => city.name === filters.cityName || city.id === filters.cityId,
    );
    if (!city) throw new Error("City not found");

    const pubs = await this.fetchPubsByCity(city.id);

    const filterPubByName = (pub: Pub): boolean =>
      !filters.pubName || pub.name === filters.pubName;

    const filterPubById = (pub: Pub): boolean =>
      !filters.pubId || pub.id === filters.pubId;

    const filterBeerByStyle = (beer: Beer): boolean =>
      !filters.styleRegex ||
      new RegExp(filters.styleRegex).test(beer.style || "");

    const filteredPubs = pubs.filter(filterPubByName).filter(filterPubById);

    const beers: Map<string, BeerFilterResult> = new Map();
    for (const pub of filteredPubs) {
      const currentPub = {
        pubName: pub.name,
        pubId: pub.id,
      };

      const taps = await this.fetchTaps(pub.id);
      taps.forEach((tap) => {
        if (tap.beer) {
          // fill cache to be able to fetch beer details later
          this.addBeer(tap.beer);

          const beer = beers.get(tap.beer.id);

          const beerMatchesFilters = filterBeerByStyle(tap.beer);

          if (!beerMatchesFilters) return;

          if (beer) {
            beer.pubs.push(currentPub);
          } else {
            beers.set(tap.beer.id, {
              beerId: tap.beer.id,
              pubs: [currentPub],
              beerName: tap.beer.name,
              beerStyle: tap.beer.style || "",
            });
          }
        }
      });
    }

    return Array.from(beers.values());
  }
}

const ontap = OntapService.getInstance();

ontap.getCitiesNames().then((cities) => console.log(cities));
//
ontap
  .getBeers({ cityName: "Kraków", styleRegex: "Porter" })
  .then((beers) => console.dir(beers, { depth: null }));

ontap.getBeerDetails("35974").then((beerDetails) => console.log(beerDetails));

ontap.getPubsInCity("Kraków").then((pubs) => console.log(pubs));

// ontap.getPubDetails("443").then((pub) => console.log(pub));

// todo: initial start should fetch all available cities
// todo: initial start should get kv of cities to fetch
// after that, it should fetch all pubs in city