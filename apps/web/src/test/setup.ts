import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does no layout and leaves out Element.scrollTo, which scrolling lists
// call directly. A no-op keeps those calls safe; tests that care spy on it.
Object.defineProperty(Element.prototype, "scrollTo", {
  configurable: true,
  writable: true,
  value: () => undefined,
});

afterEach(() => {
  cleanup();
});
