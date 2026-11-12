const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
};

export const getToolCacheKey = (
  name: string,
  argumentsText: string,
): string => {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    return `${name}:${JSON.stringify(sortKeys(parsed))}`;
  } catch {
    return `${name}:${argumentsText}`;
  }
};
