import { TapParsed } from "../types/types";

export const getHalfLiterPrice = (tap: TapParsed): number | null => {
  const prices = tap.variants.flatMap((variant) => {
    const volume = variant.volume.trim().toLowerCase().replace(",", ".");
    const match = /^(\d+(?:\.\d+)?)\s*(ml|l)$/.exec(volume);
    if (!match || !Number.isFinite(variant.price) || variant.price < 0)
      return [];

    const liters = Number(match[1]) / (match[2] === "ml" ? 1000 : 1);
    if (liters <= 0) return [];

    return [
      {
        liters,
        price: Math.round((variant.price / 100 / liters) * 0.5 * 100) / 100,
      },
    ];
  });
  const halfLiter = prices.find((variant) => variant.liters === 0.5);
  return halfLiter?.price ?? prices[0]?.price ?? null;
};
