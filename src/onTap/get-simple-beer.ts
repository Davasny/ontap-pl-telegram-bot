import {
  BeerFilterResult,
  BeerFilterResultPub,
  BeerWithTaps,
} from "../types/types";

export const getSimpleBeer = (beer: BeerWithTaps): BeerFilterResult => {
  const offers = new Map<string, BeerFilterResultPub>();
  for (const tap of beer.taps) {
    let offer = offers.get(tap.pub.id);
    if (!offer) {
      offer = {
        pubId: tap.pub.id,
        normalizedHalfLiterPricePln: null,
        servings: [],
      };
      offers.set(tap.pub.id, offer);
    }
    if (tap.halfLiterPrice !== null) {
      offer.normalizedHalfLiterPricePln = Math.min(
        offer.normalizedHalfLiterPricePln ?? Infinity,
        tap.halfLiterPrice,
      );
    }
    for (const variant of tap.variants) {
      if (!Number.isFinite(variant.price) || variant.price < 0) continue;
      const pricePln = variant.price / 100;
      if (
        !offer.servings.some(
          (item) =>
            item.volume === variant.volume && item.pricePln === pricePln,
        )
      ) {
        offer.servings.push({ volume: variant.volume, pricePln });
      }
    }
  }

  return {
    pubs: Array.from(offers.values()),
    beerId: beer.id,
    beerName: beer.name,
    beerStyle: beer.style?.trim() || null,
    abv: beer.abv,
  };
};
