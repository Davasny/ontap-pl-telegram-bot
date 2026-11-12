import { describe, expect, it } from "vitest";
import { OntapService } from "./ontap-service";

describe("OntapService.parseAbv", () => {
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
      const result = OntapService.parseAbv(input);
      expect(result).toBe(expected);
    });
  });
});
