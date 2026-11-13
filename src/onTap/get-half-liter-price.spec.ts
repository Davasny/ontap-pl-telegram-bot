import { describe, expect, it } from "vitest";
import { TapParsed, Variant } from "../types/types";
import { getHalfLiterPrice } from "./get-half-liter-price";

const tapWithVariants = (variants: Variant[]): TapParsed => ({
  beer: null,
  label: null,
  new: null,
  premiere: null,
  prices: [],
  promo: null,
  tapName: "1",
  variants,
  volumes: null,
});

describe("default price basis", () => {
  it("prefers the actual half-liter price over other serving sizes", () => {
    const tap = tapWithVariants([
      { volume: "0.3l", price: 1500 },
      { volume: "0.5l", price: 2000 },
    ]);

    expect(getHalfLiterPrice(tap)).toBe(20);
  });

  it.each(["0,5 l", "500 ml"])("recognizes %s as half a liter", (volume) => {
    expect(getHalfLiterPrice(tapWithVariants([{ volume, price: 2000 }]))).toBe(20);
  });

  it("normalizes another size when no half-liter serving is available", () => {
    const tap = tapWithVariants([{ volume: "0.3l", price: 1500 }]);

    expect(getHalfLiterPrice(tap)).toBe(25);
    expect(tap.variants).toEqual([{ volume: "0.3l", price: 1500 }]);
  });

  it("keeps unavailable prices unknown rather than treating them as free", () => {
    const tap = tapWithVariants([
      { volume: "unknown", price: 2000 },
      { volume: "0.5l", price: -1 },
      { volume: "0.5l", price: NaN },
    ]);

    expect(getHalfLiterPrice(tap)).toBeNull();
    expect(getHalfLiterPrice(tapWithVariants([]))).toBeNull();
  });
});
