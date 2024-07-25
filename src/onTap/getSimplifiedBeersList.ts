import {
  BeerFilterResult,
  BeerFilterResult2,
  BeerFilterResultPub,
  BeerWithTaps,
} from "../types/types";

export const getSimpleBeer = (beer: BeerWithTaps): BeerFilterResult => {
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
};

export const getSimplifiedBeersList = (beers: BeerFilterResult2): string => {
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
