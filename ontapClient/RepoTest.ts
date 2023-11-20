import { Repository } from "./Repository";

const main = async () => {
  const repo = Repository.getInstance();

  const tmp = await repo.getPubDetails("Kraków", "SPOKO");
  console.dir(JSON.stringify(tmp));

  await Promise.all([
    repo.getBeers({
      cityName: "Kraków",
      limitBeers: 5,
      lowerCaseStyleRegex: "stout",
      priceTo: 20,
      // pubNameRegex: "viva la pinta",
      // abvTo: 10,
      // abvFrom: 8
    }),
  ]).then((values) => {
    console.dir(values, { depth: null });
  });
};

main();
