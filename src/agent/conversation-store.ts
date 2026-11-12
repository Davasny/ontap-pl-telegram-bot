import Keyv from "keyv";
import KeyvSqlite from "@keyv/sqlite";

export const createConversationStore = (persistentDataPath: string) =>
  new Keyv<string>({
    store: new KeyvSqlite(`sqlite://${persistentDataPath}/db.sqlite`),
    namespace: "keyv",
  });
