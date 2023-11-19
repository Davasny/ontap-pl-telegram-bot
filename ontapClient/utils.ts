import { createHash } from "crypto";

export const generateHash = (input: string): string => {
  return createHash("sha256").update(input).digest("hex");
};
