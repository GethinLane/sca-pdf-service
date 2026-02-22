import { chromium as playwrightChromium } from "playwright-core";
import chromium from "@sparticuz/chromium";
import { marked } from "marked";
import path from "path";

const ALLOWED_ORIGINS = new Set([
  "https://www.scarevision.ai",
  "https://scarevision.ai",
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHtmlDocument({ title, logoUrl, bodyHtml }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 18mm 16mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 11.5pt;
      line-height: 1.45;
      color: #111;
    }
    .wrap { max-width: 1280px; margin: 0 auto; }
    .header { margin-bottom: 14mm; }
    .logo { height: 18mm; width: auto; display: block; }
    h1 { font-size: 18pt; margin: 8mm 0 0; }
    h2 { font-size: 13.5pt; margin: 10mm 0 3mm; break-after: avoid; }
    h3 { font-size: 12pt; margin: 8mm 0 2mm; break-after: avoid; }
    p { margin: 3mm 0; }
    ul, ol { margin: 3mm 0 3mm 6mm; padding: 0; }
    li { margin: 1.5mm 0; }
    p, li { orphans: 3; widows: 3; }
    h2 { border-top: 1px solid #e5e5e5; padding-top: 4mm; }
    h2:first-of-type { border-top: none; padding-top: 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Logo" />` : ""}
      <h1>${escapeHtml(title || "Consultation Feedback Report")}</h1>
    </div>
    <div class="content">${bodyHtml}</div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  // CORS headers for every response (including errors)
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    const title = body.title || "Consultation Feedback Report";
    const logoUrl = body.logoUrl || "";
    const filename = body.filename || "consultation-feedback.pdf";

    const markdown = String(body.markdown || "");
    const html = String(body.html || "");
    if (!html && !markdown) {
      res.status(400).json({ error: "Missing 'html' or 'markdown' in request body" });
      return;
    }
    if (markdown.length > 200_000 || html.length > 400_000) {
      res.status(413).json({ error: "Payload too large" });
      return;
    }

    const bodyHtml = html
      ? html
      : marked.parse(markdown, { gfm: true, breaks: true });

    const fullHtml = buildHtmlDocument({ title, logoUrl, bodyHtml });

    // Optional: prevent GPU-related hangs (if supported by your chromium package version)
    if (typeof chromium.setGraphicsMode === "function") {
      chromium.setGraphicsMode(false);
    }

    const executablePath = await chromium.executablePath();
    const execDir = path.dirname(executablePath);

    // ✅ CRITICAL FIX: tell the loader where the extracted libs are (libnss3.so etc.)
    process.env.LD_LIBRARY_PATH = execDir;

    const headless =
      typeof chromium.headless === "boolean"
        ? chromium.headless
        : String(chromium.headless).toLowerCase() !== "false";

    const browser = await playwrightChromium.launch({
      args: chromium.args,
      executablePath,
      headless,
    });

    const page = await browser.newPage();

    // networkidle can sometimes hang if something keeps a connection open;
    // load is often enough for PDFs
    await page.setContent(fullHtml, { waitUntil: "load" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    await page.close();
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err?.message || "PDF generation failed" });
  }
}
