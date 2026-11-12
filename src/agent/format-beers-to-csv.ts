import { BeerFilterResult } from "../types/types";

export const formatBeersToCsv = (beers: BeerFilterResult[]): string => {
  const header = "beerId;beerName;beerStyle;abv;pubs\n";

  const rows = beers.map((beer) => {
    const pubsString = beer.pubs
      .map((pub) => `pubName: ${pub.pubName}, price: ${pub.halfLiterPrice}`)
      .join("|");

    const row = beer.pubs.map((pub) => {
      return `"${beer.beerId}";"${beer.beerName}";"${beer.beerStyle}";"${beer.abv}";"${pubsString}"\n`;
    });

    return row.join("\n");
  });

  return header + rows.join("\n");
};
