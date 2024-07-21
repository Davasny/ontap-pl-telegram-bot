import sha256 from "crypto-js/sha256";

export const generateHash = (input: string): string => {
  return sha256(input).toString();
};
