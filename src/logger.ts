import Pino from "pino";
import {
  getPinoMixinFunction,
  getPinoTransport,
  initSDK,
} from "@hyperdx/node-opentelemetry";
import "dotenv/config";

initSDK({
  service: "ontap-bot",
  consoleCapture: false,
});

export const logger = Pino({
  mixin: getPinoMixinFunction,
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          singleLine: true,
          ignore: "pid,hostname",
        },
      },
      getPinoTransport("debug", {
        detectResources: false,
      }),
    ],
  },
  level: "debug",
});
