const TEXT_INPUT_TYPES: Readonly<Record<string, true>> = {
  text: true,
  search: true,
  url: true,
  email: true,
  tel: true,
  password: true,
  number: true,
  date: true,
  "datetime-local": true,
  month: true,
  time: true,
  week: true,
};

/** Narrows an event target to the element that owns the menu surface. */
export function elementFromTarget(target: EventTarget | null): Element | null {
  if (target === null) {
    return null;
  }
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

/**
 * Whether a right-click belongs to a field that should keep the native menu.
 * Non-text inputs (checkbox, range, file, button…) have no text menu, so they
 * are not treated as editable and are suppressed like the rest of the chrome.
 */
export function isEditableTarget(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES[element.type] === true;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  const editable = element.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}
