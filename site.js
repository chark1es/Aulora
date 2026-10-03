// Progressive enhancements for the marketing pages and docs. Without JavaScript
// the pages still read, the workspace switcher still works, and download links
// still open the right section.

import { mountDemo } from "./demo.js";
import { applyDownloads, detectClient, loadRelease } from "./downloads.js";

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const target = button.dataset.copy
      ? document.getElementById(button.dataset.copy)
      : button.closest(".code")?.querySelector("code");
    if (!target || !navigator.clipboard) return;
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Press ⌘C";
    }
    window.setTimeout(() => {
      button.textContent = label;
    }, 1600);
  });
}

const docsNav = document.querySelector(".docs-nav");
if (docsNav && window.matchMedia("(max-width: 900px)").matches) docsNav.open = false;

const tocLinks = [...document.querySelectorAll(".toc a")];
if (tocLinks.length > 0 && "IntersectionObserver" in window) {
  const byId = new Map(tocLinks.map((link) => [link.hash.slice(1), link]));
  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const first = [...byId.keys()].find((id) => visible.has(id));
      if (first !== undefined) {
        for (const link of tocLinks) link.toggleAttribute("aria-current", link === byId.get(first));
      }
    },
    { rootMargin: "-96px 0px -60% 0px" },
  );
  for (const id of byId.keys()) {
    const heading = document.getElementById(id);
    if (heading) observer.observe(heading);
  }
}

const demo = document.querySelector("[data-demo]");
if (demo) mountDemo(demo);

if (document.querySelector("[data-downloads], [data-download]")) {
  detectClient()
    .then(async (client) => {
      let release = null;
      try {
        release = await loadRelease();
      } catch {
        release = null;
      }
      applyDownloads(document, client, release);
    })
    .catch(() => {
      // Leave the authored links in place.
    });
}
