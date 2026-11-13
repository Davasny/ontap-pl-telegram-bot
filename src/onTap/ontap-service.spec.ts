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

describe("Check ontap api", () => {
  it("returns cities", async () => {
    const onTap = new OntapService();
    const cities = await onTap.getCities();

    expect(cities).toBeDefined();
    expect(cities.length).toBeGreaterThan(0);
    expect(cities.map((c) => c.name)).toContain("Kraków");
  });
});
