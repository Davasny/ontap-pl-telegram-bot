import { Repository } from "./Repository";

const main = async () => {
  const repo = Repository.getInstance();

  const tmp = await repo.getPubDetails("Kraków", "SPOKO");
  console.dir(JSON.stringify(tmp));

  const beers = await repo.getBeers({
    cityName: "Kraków",
    limitBeers: 20,
    lowerCaseStyleRegex: "ipa",
    // priceTo: 20,
    // pubNameRegex: "viva la pinta",
    // abvTo: 10,
    // abvFrom: 8
  });
  const simplified = repo.simplifyGetBeersOutput(beers);
  console.log(JSON.stringify(beers))
  console.log()
  console.log(simplified)

  console.log("json", JSON.stringify(beers).length);
  console.log("simplified", simplified.length);
};

main();
