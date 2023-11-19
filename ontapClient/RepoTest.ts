import { Repository } from "./Repository";

const main = async () => {
  const repo = new Repository();
  const beers = await repo.getBeers({
    cityName: "Kraków",
    limitBeers: 5,
    lowerCaseStyleRegex: "sour",
    priceTo: 20
  })

  console.dir(beers, { depth: null});
};

main();
