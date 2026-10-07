// A tiny, dependency-free Markdown-to-HTML renderer for the Aulora docs site.
//
// It intentionally supports the small subset the docs use: headings, paragraphs,
// fenced code, lists, blockquotes, horizontal rules, inline code, bold, italic
// and links. Raw HTML in the source is escaped, so a doc can never inject markup.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for safe insertion into HTML. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Rewrites a relative `*.md` link to a clean, extensionless URL for the
 * generated site. The files on disk stay `<page>.html` so old links keep
 * working, but links and canonical URLs omit the extension.
 */
export function rewriteLink(href) {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) {
    return href;
  }
  return href.replace(/\.md(#|$)/i, "$1").replace(/^\.\//, "");
}

function inline(text) {
  let html = escapeHtml(text);
  // Inline code first so its contents are not processed further.
  const code = [];
  html = html.replace(/`([^`]+)`/g, (_match, body) => {
    code.push(`<code>${body}</code>`);
    return `\uE000${code.length - 1}\uE001`;
  });
  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const safeHref = escapeHtml(rewriteLink(href));
      return `<a href="${safeHref}">${label}</a>`;
    });
  return html.replace(/\uE000(\d+)\uE001/g, (_match, index) => code[Number(index)]);
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function tableSeparator(line) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * Renders Markdown to HTML. Returns `{ html, title }`, where `title` is the
 * first level-1 heading when present.
 */
export function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let title = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1];
      const body = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      const className = language ? ` class="language-${escapeHtml(language)}"` : "";
      out.push(`<pre><code${className}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level === 1 && title === null) {
        title = text;
      }
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push("<hr />");
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>${inline(body.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\s*[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        index += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && tableSeparator(lines[index + 1])) {
      const headers = tableCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|")) {
        const cells = tableCells(lines[index]);
        rows.push(
          `<tr>${headers.map((_header, column) => `<td>${inline(cells[column] ?? "")}</td>`).join("")}</tr>`,
        );
        index += 1;
      }
      out.push(
        `<div class="table-scroll"><table><thead><tr>${headers.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
      );
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !/^(#{1,6}\s|```|>\s?|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }

  return { html: out.join("\n"), title };
}
