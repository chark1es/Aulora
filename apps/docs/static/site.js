// Small progressive enhancements for the landing page and docs. Everything
// here is optional: without JavaScript the site still reads and navigates.

// Copy buttons on code blocks and the install one-liner.
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const target = button.dataset.copy
      ? document.getElementById(button.dataset.copy)
      : button.closest(".code")?.querySelector("code");
    if (!target || !navigator.clipboard) {
      return;
    }
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

// On narrow screens the docs contents start collapsed.
const docsNav = document.querySelector(".docs-nav");
if (docsNav && window.matchMedia("(max-width: 900px)").matches) {
  docsNav.open = false;
}

// Highlight the section being read in "On this page".
const tocLinks = [...document.querySelectorAll(".toc a")];
if (tocLinks.length > 0 && "IntersectionObserver" in window) {
  const byId = new Map(tocLinks.map((link) => [link.hash.slice(1), link]));
  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target.id);
        } else {
          visible.delete(entry.target.id);
        }
      }
      const first = [...byId.keys()].find((id) => visible.has(id));
      if (first !== undefined) {
        for (const link of tocLinks) {
          link.toggleAttribute("aria-current", link === byId.get(first));
        }
      }
    },
    { rootMargin: "-96px 0px -60% 0px" },
  );
  for (const id of byId.keys()) {
    const heading = document.getElementById(id);
    if (heading) {
      observer.observe(heading);
    }
  }
}
