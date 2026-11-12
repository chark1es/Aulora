import { expect, it } from "vitest";
import { remainingComposerFiles } from "../src/lib/composer-files";

it("removes submitted keys while preserving files added during send", () => {
  const added = { key: "new" };
  expect(remainingComposerFiles([{ key: "sent" }, added], [{ key: "sent" }])).toEqual([added]);
});
