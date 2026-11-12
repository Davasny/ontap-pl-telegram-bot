import { OntapService } from "../onTap/ontap-service";
import { BeerFilterResultSortBy, BeersFilters } from "../types/types";

type BeerSearchFilter = Omit<BeersFilters, "cityName" | "limitBeers" | "pubId">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBeerFilter = (value: unknown): value is BeerSearchFilter => {
  if (!isRecord(value)) return false;
  const strings = ["lowerCaseStyleRegex", "lowerCaseBeerNameRegex"];
  const numbers = ["priceFrom", "priceTo", "abvFrom", "abvTo"];
  if (
    Object.keys(value).some(
      (key) => !strings.includes(key) && !numbers.includes(key),
    )
  )
    return false;
  for (const key of strings) {
    const item = value[key];
    if (item !== undefined && (typeof item !== "string" || item.length > 120))
      return false;
  }
  for (const key of numbers) {
    const item = value[key];
    if (
      item !== undefined &&
      (typeof item !== "number" ||
        !Number.isFinite(item) ||
        item < 0 ||
        (key.startsWith("abv") && item > 100))
    )
      return false;
  }
  return true;
};

const sorts: BeerFilterResultSortBy[] = [
  "priceAsc",
  "priceDesc",
  "alcoholToPriceRatioAsc",
  "alcoholToPriceRatioDesc",
  "alcoholAbvAsc",
  "alcoholAbvDesc",
];
const invalid = {
  status: "invalid_arguments",
  message: "Check the tool schema and supply valid arguments.",
};

export const executeTool = async (
  onTap: OntapService,
  name: string,
  argumentsText: string,
): Promise<unknown> => {
  let args: unknown;
  try {
    args = JSON.parse(argumentsText);
  } catch {
    return invalid;
  }
  if (!isRecord(args)) return invalid;
  if (name === "getCitiesNames")
    return { cities: await onTap.getCitiesNames() };
  if (
    typeof args.cityName !== "string" ||
    !args.cityName.trim() ||
    args.cityName.length > 100
  )
    return invalid;

  if (name === "findPubs") {
    if (typeof args.query !== "string" || args.query.length > 200)
      return invalid;
    return onTap.findPubs(args.cityName, args.query);
  }
  if (name === "getPubDetails") {
    if (typeof args.pubId !== "string" || !args.pubId.trim()) return invalid;
    return onTap.getPubDetails(args.cityName, args.pubId);
  }
  if (name === "getBeers" || name === "getPubBeers") {
    const sort = sorts.find((value) => value === args.sortBy);
    const filter = args.filter ?? {};
    const limit = args.limitBeers;
    if (
      !sort ||
      !isBeerFilter(filter) ||
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      return invalid;
    if (
      filter.priceFrom !== undefined &&
      filter.priceTo !== undefined &&
      filter.priceFrom > filter.priceTo
    )
      return invalid;
    if (
      filter.abvFrom !== undefined &&
      filter.abvTo !== undefined &&
      filter.abvFrom > filter.abvTo
    )
      return invalid;
    try {
      if (filter.lowerCaseStyleRegex) new RegExp(filter.lowerCaseStyleRegex);
      if (filter.lowerCaseBeerNameRegex)
        new RegExp(filter.lowerCaseBeerNameRegex);
    } catch {
      return {
        ...invalid,
        message: "Invalid search regex. Supply a valid simple pattern.",
      };
    }
    if (name === "getPubBeers") {
      if (typeof args.pubId !== "string" || !args.pubId.trim()) return invalid;
      return onTap.getPubBeers(args.cityName, args.pubId, filter, sort, limit);
    }
    return onTap.getBeers(
      { ...filter, cityName: args.cityName, limitBeers: limit },
      sort,
    );
  }
  return {
    status: "unknown_tool",
    message: "Use one of the currently available tools.",
  };
};
