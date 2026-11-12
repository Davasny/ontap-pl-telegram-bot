import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createConversationStore } from "./conversation-store";

it("preserves existing Keyv conversation IDs and persists new values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ontap-conversations-"));

  try {
    const database = new DatabaseSync(join(directory, "db.sqlite"));
    database.exec(
      "CREATE TABLE keyv (key VARCHAR(255) PRIMARY KEY, value TEXT)",
    );
    database
      .prepare("INSERT INTO keyv (key, value) VALUES (?, ?)")
      .run(
        "keyv:conversationId-test-user",
        JSON.stringify({ value: "conv_existing", expires: null }),
      );
    database.close();

    const store = createConversationStore(directory);
    try {
      expect(await store.get("conversationId-test-user")).toBe("conv_existing");
      await store.set("conversationId-new-user", "conv_new");
    } finally {
      await store.disconnect();
    }

    const reopenedStore = createConversationStore(directory);
    try {
      expect(await reopenedStore.get("conversationId-new-user")).toBe(
        "conv_new",
      );
    } finally {
      await reopenedStore.disconnect();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
