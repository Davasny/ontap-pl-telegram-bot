import { describe, expect, it } from "vitest";
import { OnTapService } from "./OnTapService";

describe("OnTapService.parseAbv", () => {
  const cases: { input: string | null; expected: number | null }[] = [
    { input: "4.5", expected: 4.5 },
    { input: "4.5%", expected: 4.5 },
    { input: "4,5", expected: 4.5 },
    { input: "4.5", expected: 4.5 },
    { input: "<0.5", expected: 0.5 },
    { input: null, expected: null },
  ];

  cases.forEach(({ input, expected }) => {
    it(`${input} should return ${expected}`, () => {
      const result = OnTapService.parseAbv(input);
      expect(result).toBe(expected);
    });
  });
});
