import wretch from "wretch";
import { v4 as uuid4 } from "uuid";

const API_KEY = "855ce5a3211d806ce94f1f14d17a3b4c";

const headers = {
  "api-key": API_KEY,
  "device-id": uuid4(),
};

const apiClient = wretch("https://ontap.pl/api/v1").headers(headers);

interface City {
  id: string;
  name: string;
}

interface Pub {
  id: string;
  name: string;
  lat: string;
  lon: string;
  city: string;
  address: string;
  volumes: string; //0.2l;0.3l;0.5l
  phone: string | null;
  url: string | null;
  logo_url: string;
  taps_count: number;
  active_taps_count: number;
}

interface Beer {
  abv: number | null;
  brewery: string;
  color: string | null;
  ibu: string | null;
  id: number;
  name: string;
  origin: string | null;
  plato: number | null;
  rateBeerScore: number | null;
  rateBeerUrl: string | null;
  style: string | null;
  untappedScore: number | null;
  untappedUrl: string | null;
}

interface Variant {
  price: number;
  volume: string;
}

interface Tap {
  beer: Beer | null;
  label: string | null;
  new: boolean | null;
  premiere: boolean | null;
  prices: number[];
  promo: boolean | null;
  tapName: string;
  variants: Variant[];
  volumes: string | null;
}

interface MarkdownTable {
  brewery: string;
  name: string;
  style: string;
  pubName: string;
  beerId: number | null;
}

interface TableData {
  city: string;
  taps: MarkdownTable[];
}

interface BeerTable {
  id: number;
  name: string;
  brewery: string;
  style: string;
  pubs: string[];
}

function generateMarkdownTable(beers: BeerTable[]): string {
  // Table header
  let markdown = `Name|Brewery|Style|Pubs\n`;
  markdown += `------|--------|-------|------\n`;

  // Table rows
  beers.forEach((beer) => {
    markdown += `${beer.name}|${beer.brewery}|${beer.style}|${
      beer.pubs.join(
        ",",
      )
    }\n`;
  });

  return markdown;
}

const getCities = (): Promise<City[]> =>
  apiClient.url("/cities").get().json<City[]>();

const getPubs = (cityId: string): Promise<Pub[]> =>
  apiClient.url(`/cities/${cityId}/pubs`).get().json();

const getTaps = (pubId: string): Promise<Tap[]> =>
  apiClient.url(`/pubs/${pubId}/taps`).get().json();

const printCities = async () => {
  const cities = await getCities();

  const cracowId = cities.find((city) => city.name === "Kraków")?.id;

  if (!cracowId) {
    console.error("Cracow not found");
    return;
  }

  const cracowTaps: TableData = {
    city: "Kraków",
    taps: [],
  };

  const pubs = await getPubs(cracowId);

  console.log(pubs.length);

  for (const pub of pubs) {
    const taps = await getTaps(pub.id);
    console.log(taps.length);

    taps.forEach((tap) =>
      cracowTaps.taps.push({
        name: tap.beer?.name || "",
        brewery: tap.beer?.brewery || "",
        style: tap.beer?.style || "",
        pubName: pub.name,
        beerId: tap.beer?.id || null,
      })
    );
  }

  const beers: BeerTable[] = [];

  cracowTaps.taps.forEach((tap) => {
    const beer = beers.find((beer) => beer.id === tap.beerId);
    if (beer) {
      beer.pubs.push(tap.pubName);
    } else {
      beers.push({
        id: tap.beerId || 0,
        name: tap.name,
        brewery: tap.brewery,
        style: tap.style,
        pubs: [tap.pubName],
      });
    }
  });

  const availableStyles = beers
    .map((beer) => beer.style)
    .filter((style) => style !== null) as string[];
  const availableBreweries = beers
    .map((beer) => beer.brewery)
    .filter((brewery) => brewery !== null) as string[];
  const availablePubs = pubs.map((pub) => pub.name);

  const stylesMap = new Map<string, number>();
  const breweriesMap = new Map<string, number>();
  const pubsMap = new Map<string, number>();

  availableStyles.forEach((style, index) => {
    stylesMap.set(style, index);
  });

  availableBreweries.forEach((brewery, index) => {
    breweriesMap.set(brewery, index);
  });

  availablePubs.forEach((pub, index) => {
    pubsMap.set(pub, index);
  });

  const beersWithIds = beers.map((beer) => ({
    ...beer,
    style: stylesMap.get(beer.style) || 0,
    brewery: breweriesMap.get(beer.brewery) || 0,
    pubs: beer.pubs.map((pub) => pubsMap.get(pub) || 0),
  }));

  // console.log(generateMarkdownTable(beersWithIds));

  console.log(stylesMap.entries(), Object.entries(stylesMap));

  console.log(
    "style",
    Array.from(stylesMap.entries())
      .map(([key, value]) => `${value}: ${key}`)
      .join(","),
  );
};

printCities();
