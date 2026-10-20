// Progressive enhancements for the marketing pages and docs. Without JavaScript
// the pages still read, the workspace switcher still works, and download links
// still open the right section. Feature modules are imported only when their
// markup is present, so the demo, downloads and environment filter never cost a
// page that does not use them.

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

// The interactive demo is mounted only on the pages that embed it.
if (document.querySelector("[data-demo]")) {
  void import("./demo.js").then(({ mountDemo }) => {
    const demo = document.querySelector("[data-demo]");
    if (demo) mountDemo(demo);
  });
}

// Download buttons appear on the landing and install pages.
if (document.querySelector("[data-downloads], [data-download]")) {
  void import("./downloads.js").then(({ applyDownloads, detectClient, loadRelease }) => {
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
  });
}

// The filter box is generated only on the environment reference page.
if (document.querySelector("[data-env-filter]")) {
  void import("./env-filter.js").then(({ mountEnvFilter }) => {
    mountEnvFilter();
  });
}

// The search palette sits in the shared header on every page.
if (document.querySelector("[data-search]")) {
  void import("./search.js").then(({ mountSearch }) => {
    mountSearch();
  });
}
