import type { ChannelView } from "@aulora/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelSidebar, type ChannelSidebarProps } from "../components/chat/ChannelSidebar";
import { computeCategoryReorder } from "../components/chat/category-reorder";
import { CATEGORY_DRAG_TYPE } from "../components/chat/use-category-drag";
import type { CategoryView } from "../lib/workspace-admin";

const CATEGORIES: CategoryView[] = [
  { id: "cat-a", name: "Alpha", position: 0, overrides: [] },
  { id: "cat-b", name: "Beta", position: 1, overrides: [] },
  { id: "cat-c", name: "Gamma", position: 2, overrides: [] },
];

describe("computeCategoryReorder", () => {
  it("moves a category before another and renumbers positions", () => {
    expect(computeCategoryReorder(CATEGORIES, "cat-c", "cat-a", "before")).toEqual([
      { categoryId: "cat-c", position: 0 },
      { categoryId: "cat-a", position: 1 },
      { categoryId: "cat-b", position: 2 },
    ]);
  });

  it("moves a category after another", () => {
    expect(computeCategoryReorder(CATEGORIES, "cat-a", "cat-b", "after")).toEqual([
      { categoryId: "cat-b", position: 0 },
      { categoryId: "cat-a", position: 1 },
      { categoryId: "cat-c", position: 2 },
    ]);
  });

  it("returns null for a no-op, same header or unknown id", () => {
    expect(computeCategoryReorder(CATEGORIES, "cat-a", "cat-a", "before")).toBeNull();
    expect(computeCategoryReorder(CATEGORIES, "cat-b", "cat-c", "before")).toBeNull();
    expect(computeCategoryReorder(CATEGORIES, "missing", "cat-a", "before")).toBeNull();
    expect(computeCategoryReorder(CATEGORIES, "cat-a", "missing", "after")).toBeNull();
  });

  it("sorts by position before moving", () => {
    const shuffled: CategoryView[] = [
      { id: "cat-c", name: "Gamma", position: 2, overrides: [] },
      { id: "cat-a", name: "Alpha", position: 0, overrides: [] },
      { id: "cat-b", name: "Beta", position: 1, overrides: [] },
    ];
    expect(computeCategoryReorder(shuffled, "cat-a", "cat-c", "after")).toEqual([
      { categoryId: "cat-b", position: 0 },
      { categoryId: "cat-c", position: 1 },
      { categoryId: "cat-a", position: 2 },
    ]);
  });
});

function sidebarProps(overrides: Partial<ChannelSidebarProps> = {}): ChannelSidebarProps {
  const channels: ChannelView[] = [
    {
      id: "general",
      kind: "text",
      categoryId: null,
      name: "general",
      topic: null,
      archived: false,
    },
  ];
  return {
    workspaceName: "Acme",
    workspaceIconSeed: "aulora:server:acme",
    ownUserId: "me",
    ownName: "Me",
    ownStatus: "online",
    onlineCount: 1,
    channels,
    categories: CATEGORIES,
    titles: new Map(),
    presenceOf: () => "online",
    activeChannelId: undefined,
    unreadByChannel: new Map(),
    canCreateChannel: true,
    onSelect: vi.fn(),
    onCreateChannel: vi.fn(),
    onNewConversation: vi.fn(),
    onOpenSearch: vi.fn(),
    onSetStatus: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
}

function headerFor(categoryId: string): HTMLElement {
  const button = screen.getByTestId(`category-header-${categoryId}`);
  const header = button.parentElement;
  if (header === null) {
    throw new Error("missing category header container");
  }
  return header;
}

function dataTransferStub() {
  return {
    effectAllowed: "none",
    dropEffect: "none",
    types: [] as string[],
    setData: vi.fn<(type: string, value: string) => void>(),
  };
}

describe("category header dragging", () => {
  it("is draggable only when the viewer may reorder categories", () => {
    const { unmount } = render(<ChannelSidebar {...sidebarProps()} />);
    expect(headerFor("cat-a")).not.toHaveAttribute("draggable");
    unmount();
    render(
      <ChannelSidebar
        {...sidebarProps({ canReorderCategories: true, onReorderCategories: vi.fn() })}
      />,
    );
    expect(headerFor("cat-a")).toHaveAttribute("draggable", "true");
  });

  it("drops a dragged category below the hovered header", () => {
    const onReorderCategories = vi.fn();
    render(
      <ChannelSidebar {...sidebarProps({ canReorderCategories: true, onReorderCategories })} />,
    );
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(headerFor("cat-a"), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(CATEGORY_DRAG_TYPE, "cat-a");
    fireEvent.dragOver(headerFor("cat-b"), { dataTransfer, clientY: 0 });
    fireEvent.drop(headerFor("cat-b"), { dataTransfer, clientY: 0 });
    expect(onReorderCategories).toHaveBeenCalledWith([
      { categoryId: "cat-b", position: 0 },
      { categoryId: "cat-a", position: 1 },
      { categoryId: "cat-c", position: 2 },
    ]);
  });
});
