#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// User-level env vars in some setups (PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true,
// PUPPETEER_EXECUTABLE_PATH=/opt/homebrew/bin/chromium) point puppeteer at an
// outdated system Chromium that crashes on recent macOS. Unset them here so
// puppeteer uses the version it ships with under node_modules/.cache.
delete process.env.PUPPETEER_EXECUTABLE_PATH;
delete process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
delete process.env.PUPPETEER_SKIP_DOWNLOAD;

const { mdToPdf } = await import("md-to-pdf");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CHAPTER_RE = /^(\d+)\.\s.+\.md$/;
const README = "README.md";
const OUTPUT_PDF = "Робот и мальчик.pdf";

const NAV_PREV_START = "<!-- nav:prev:start -->";
const NAV_PREV_END = "<!-- nav:prev:end -->";
const NAV_NEXT_START = "<!-- nav:next:start -->";
const NAV_NEXT_END = "<!-- nav:next:end -->";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripBlock(text, startMarker, endMarker) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRe(startMarker)}[\\s\\S]*?${escapeRe(endMarker)}\\s*(?:\\n|$)`,
    "g",
  );
  return text.replace(pattern, (_match, offset) => (offset === 0 ? "" : "\n"));
}

function findChapters() {
  const entries = readdirSync(ROOT, { withFileTypes: true });
  const chapters = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(CHAPTER_RE);
    if (!m) continue;
    chapters.push({ filename: entry.name, number: parseInt(m[1], 10) });
  }
  chapters.sort((a, b) => a.number - b.number);
  return chapters;
}

function readClean(filename) {
  const text = readFileSync(join(ROOT, filename), "utf8");
  let body = stripBlock(text, NAV_PREV_START, NAV_PREV_END);
  body = stripBlock(body, NAV_NEXT_START, NAV_NEXT_END);
  return body.trim();
}

const PAGE_BREAK = '<div class="page-break"></div>';

const CSS = `
  @page {
    margin: 20mm 18mm 22mm 18mm;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
    line-height: 1.55;
    color: #1f1f1f;
    font-size: 11.5pt;
  }
  h1, h2, h3, h4 { color: #111; line-height: 1.25; }
  h1 { font-size: 1.9em; margin: 0.8em 0 0.6em; }
  h2 { font-size: 1.4em; margin: 1.4em 0 0.5em; }
  h3 { font-size: 1.15em; margin: 1.2em 0 0.4em; }
  p { margin: 0.55em 0; }
  .page-break { page-break-after: always; }
  code {
    font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    background: #f2f2f2;
    padding: 0.08em 0.32em;
    border-radius: 3px;
    font-size: 0.88em;
  }
  pre {
    background: #f5f5f5;
    padding: 12px 14px;
    border-radius: 4px;
    overflow-x: auto;
    line-height: 1.4;
    page-break-inside: avoid;
  }
  pre code { background: transparent; padding: 0; font-size: 0.85em; }
  blockquote {
    border-left: 3px solid #ddd;
    margin: 0.6em 0 0.6em 0;
    padding: 0.1em 0 0.1em 12px;
    color: #555;
  }
  a { color: #1a4fbf; text-decoration: none; }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; }
`;

async function main() {
  const chapters = findChapters();
  const parts = [];

  if (existsSync(join(ROOT, README))) {
    parts.push(readClean(README));
  } else {
    console.error(`[build-pdf] ${README} not found`);
  }
  for (const ch of chapters) {
    parts.push(readClean(ch.filename));
  }
  if (parts.length === 0) {
    console.log("[build-pdf] no source files found, skipping");
    return;
  }

  const combined = parts.join(`\n\n${PAGE_BREAK}\n\n`);

  const result = await mdToPdf(
    { content: combined },
    {
      dest: join(ROOT, OUTPUT_PDF),
      css: CSS,
      pdf_options: {
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", bottom: "22mm", left: "18mm", right: "18mm" },
      },
      launch_options: { args: ["--no-sandbox"] },
    },
  );

  if (!result) {
    console.error("[build-pdf] failed to generate PDF");
    process.exit(1);
  }

  console.log(`[build-pdf] generated ${OUTPUT_PDF}`);

  try {
    execFileSync("git", ["add", "--", OUTPUT_PDF], { cwd: ROOT, stdio: "inherit" });
  } catch (err) {
    console.error("[build-pdf] git add failed:", err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[build-pdf] error:", err);
  process.exit(1);
});
