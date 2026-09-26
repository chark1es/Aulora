import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeHtml, renderMarkdown, rewriteLink } from "./markdown.mjs";

test("escapeHtml neutralizes markup", () => {
  assert.equal(
    escapeHtml("<script>\"x\" & 'y'</script>"),
    "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
  );
});

test("rewriteLink maps .md to .html and leaves external links alone", () => {
  assert.equal(rewriteLink("self-hosting.md"), "self-hosting.html");
  assert.equal(rewriteLink("./admin.md#backups"), "admin.html#backups");
  assert.equal(rewriteLink("https://example.com/x.md"), "https://example.com/x.md");
  assert.equal(rewriteLink("#section"), "#section");
});

test("renderMarkdown captures the title and renders headings", () => {
  const { html, title } = renderMarkdown("# Hello World\n\nSome **bold** text.");
  assert.equal(title, "Hello World");
  assert.match(html, /<h1 id="hello-world">Hello World<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test("renderMarkdown escapes raw HTML in paragraphs", () => {
  const { html } = renderMarkdown('<img src="x" onerror="alert(1)">');
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img/);
});

test("renderMarkdown renders fenced code, lists and blockquotes", () => {
  const { html } = renderMarkdown(
    "```sh\nbun install\n```\n\n- one\n- two\n\n> note\n\n1. first\n2. second",
  );
  assert.match(html, /<pre><code class="language-sh">bun install<\/code><\/pre>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<blockquote>note<\/blockquote>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test("renderMarkdown links .md docs to .html", () => {
  const { html } = renderMarkdown("See [self-hosting](self-hosting.md).");
  assert.match(html, /<a href="self-hosting.html">self-hosting<\/a>/);
});
