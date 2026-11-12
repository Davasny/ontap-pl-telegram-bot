export type CityName = string;
export type PubId = string;
export type TapName = string;
export type TapId = `${PubId}-${TapName}`;
export type BeerId = string;

export interface City {
  id: string;
  name: CityName;
}

export interface Pub {
  id: PubId;
  name: string;
  lat: string;
  lon: string;
  city: string;
  address: string;
  volumes: string;
  phone: string | null;
  url: string | null;
  logo_url: string;
  taps_count: number;
  active_taps_count: number;
}

export interface Beer {
  id: BeerId;
  abv: string | null;
  brewery: string;
  color: string | null;
  ibu: string | null;
  name: string;
  origin: string | null;
  plato: number | null;
  rateBeerScore: number | null;
  rateBeerUrl: string | null;
  style: string | null;
  untappedScore: number | null;
  untappedUrl: string | null;
}

export interface Variant {
  price: number;
  volume: string;
}

export interface Tap {
  beer: Beer | null;
  label: string | null;
  new: boolean | null;
  premiere: boolean | null;
  prices: number[];
  promo: boolean | null;
  tapName: TapName;
  variants: Variant[];
  volumes: string | null;
}

// Utility type to transform Beer.abv from string | null to number | null
type TransformAbv<T extends { abv: unknown }> = Omit<T, "abv"> & {
  abv: number | null;
};

export type BeerParsed = TransformAbv<Beer>;

// Define TapParsed using the utility type
export interface TapParsed extends Omit<Tap, "beer"> {
  beer: BeerParsed | null;
}

export interface TapWithPub extends TapParsed {
  pub: Pub;
  halfLiterPrice: number | null;
  halfLiterAlcoholWeight: number | null;

  /*
   * "6% - 0.95 - 25zl",
   * "6% - 1.18 - 20zl",
   */
  alcoholToPriceRatio: number | null;
}

export interface BeerWithTaps extends BeerParsed {
  taps: TapWithPub[];
}

export interface BeersFilters {
  cityName: string;
  limitBeers: number;

  lowerCaseStyleRegex?: string;
  lowerCaseBeerNameRegex?: string;
  pubId?: string;
  priceFrom?: number;
  priceTo?: number;
  abvFrom?: number;
  abvTo?: number;
}

export type BeerFilterResultSortBy =
  | "priceAsc"
  | "priceDesc"
  | "alcoholToPriceRatioAsc"
  | "alcoholToPriceRatioDesc"
  | "alcoholAbvAsc"
  | "alcoholAbvDesc";

export interface BeerFilterResultPub {
  pubId: string;
  normalizedHalfLiterPricePln: number | null;
  servings: { volume: string; pricePln: number }[];
}

export interface BeerFilterResult {
  beerName: BeerParsed["name"];
  beerStyle: BeerParsed["style"];
  /**
   * should be used as reference for getting beer details
   */
  beerId: BeerId;
  /**
   * should be used as reference for getting pub details
   */
  pubs: BeerFilterResultPub[];

  abv: BeerParsed["abv"];
}

export interface BeerFilterResult2 {
  status: "ok" | "pub_not_found" | "no_active_taps" | "no_matching_beers";
  currency: "PLN";
  priceBasis: "normalized_0.5l";
  pubs: Pick<Pub, "id" | "name" | "address">[];
  total: number;
  returned: number;
  truncated: boolean;
  beers: BeerFilterResult[];
}
