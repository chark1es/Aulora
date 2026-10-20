import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUndoHistory } from "../components/notes/use-undo-history";

const at = (text: string, start = text.length, end = start) => ({ text, start, end });

describe("useUndoHistory", () => {
  it("never offers undo or redo for a fresh note", () => {
    const { result } = renderHook(() => useUndoHistory("note-1"));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undoes typing in the order it happened", () => {
    const { result } = renderHook(() => useUndoHistory("note-1"));
    act(() => {
      result.current.record(at("hello"), "type", 0);
      result.current.record(at("hello!"), "type", 2000);
    });
    let stepped = at("hello!?");
    act(() => {
      stepped = result.current.undo(at("hello!?")) ?? at("hello!?");
    });
    expect(stepped.text).toBe("hello!");
    expect(result.current.canRedo).toBe(true);
    act(() => {
      stepped = result.current.undo(at("hello!")) ?? at("hello!");
    });
    expect(stepped.text).toBe("hello");
  });

  it("replays redo after an undo", () => {
    const { result } = renderHook(() => useUndoHistory("note-1"));
    act(() => {
      result.current.record(at("a"), "action", 0);
    });
    act(() => {
      result.current.undo(at("ab")) ?? at("ab");
    });
    let redone = at("a");
    act(() => {
      redone = result.current.redo(at("a")) ?? at("a");
    });
    expect(redone.text).toBe("ab");
  });

  it("forgets history when the note changes", () => {
    const { result, rerender } = renderHook(({ id }) => useUndoHistory(id), {
      initialProps: { id: "note-1" },
    });
    act(() => {
      result.current.record(at("a"), "action", 0);
    });
    expect(result.current.canUndo).toBe(true);
    rerender({ id: "note-2" });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("coalesces rapid typing into one step and splits after a pause", () => {
    const { result } = renderHook(() => useUndoHistory("note-1"));
    act(() => {
      result.current.record(at(""), "type", 0);
      result.current.record(at("h"), "type", 100);
      result.current.record(at("hi"), "type", 200);
    });
    let stepped = at("hi there");
    act(() => {
      // After the pause, the next keystroke starts a fresh step from "hi".
      result.current.record(at("hi"), "type", 9000);
      stepped = result.current.undo(at("hi there")) ?? at("hi there");
    });
    expect(stepped.text).toBe("hi");
    act(() => {
      stepped = result.current.undo(at("hi")) ?? at("hi");
    });
    expect(stepped.text).toBe("");
  });
});
