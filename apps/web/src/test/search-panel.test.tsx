import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchPanel, type SearchPanelProps } from "../components/chat/SearchPanel";

function panel(overrides: Partial<SearchPanelProps> = {}) {
  return (
    <SearchPanel
      query="launch"
      results={[]}
      searching={false}
      conversations={[]}
      titles={new Map()}
      ownUserId="me"
      memberNames={new Map()}
      onQueryChange={vi.fn()}
      onSelectConversation={vi.fn()}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe("SearchPanel archive progress", () => {
  it("does not report an empty result while earlier history is still loading", () => {
    render(panel({ archive: "loading" }));
    expect(screen.getByTestId("search-archive-loading")).toBeTruthy();
    expect(screen.queryByTestId("search-empty")).toBeNull();
  });

  it("reports no matches once the whole archive has been searched", () => {
    render(panel({ archive: "complete" }));
    expect(screen.getByTestId("search-empty")).toBeTruthy();
    expect(screen.queryByTestId("search-archive-loading")).toBeNull();
  });

  it("says results are partial when earlier history could not be read", () => {
    render(panel({ archive: "failed" }));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach earlier messages");
  });

  it("shows no message results when the index has nothing for the query", () => {
    // Regression: a fresh instance searching "test" must not render phantom
    // hits; the index is scoped per instance (see search-store.test.ts).
    render(panel({ query: "test", results: [], archive: "complete" }));
    expect(screen.queryAllByTestId("search-result")).toHaveLength(0);
    expect(screen.getByTestId("search-empty").textContent).toContain("test");
  });
});
