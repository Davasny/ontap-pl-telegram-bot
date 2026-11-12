import Pino from "pino";
import "dotenv/config";

export const logger = Pino({
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          singleLine: true,
          ignore: "pid,hostname",
        },
      },
    ],
  },
  level: "debug",
});
