import {
  BeerFilterResult,
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
