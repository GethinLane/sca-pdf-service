import { chromium as playwrightChromium } from "playwright-core";
import chromium from "@sparticuz/chromium";
import { marked } from "marked";

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

function mkDebugId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowMs() {
  return Date.now();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return { raw, json: JSON.parse(raw) };
}

export default async function handler(req, res) {
  const debugId = mkDebugId();
  const t0 = nowMs();
  const log = (...args) => console.log(`[render-pdf ${debugId}]`, ...args);

  // Always set CORS headers
  setCors(req, res);

  log("START", {
    method: req.method,
    url: req.url,
    origin: req.headers.origin,
    ua: req.headers["user-agent"],
  });

  // Preflight
  if (req.method === "OPTIONS") {
    log("OPTIONS preflight -> 204");
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    log("Reject non-POST -> 405");
    res.status(405).json({ error: "Use POST", debugId });
    return;
  }

  let browser = null;
  let page = null;

  try {
    // Read body
    const tRead0 = nowMs();
    const { raw, json: body } = await readJsonBody(req);
    const tRead1 = nowMs();

    log("BODY read", {
      bytes: raw.length,
      readMs: tRead1 - tRead0,
      keys: Object.keys(body || {}),
    });

    const title = body.title || "Consultation Feedback Report";
    const logoUrl = body.logoUrl || "";
    const filename = body.filename || "consultation-feedback.pdf";

    const markdown = String(body.markdown || "");
    const html = String(body.html || "");

    log("INPUT lengths", {
      titleLen: String(title).length,
      logoUrlLen: String(logoUrl).length,
      markdownLen: markdown.length,
      htmlLen: html.length,
    });

    if (!html && !markdown) {
      log("ERROR missing html/markdown");
      res.status(400).json({ error: "Missing 'html' or 'markdown' in request body", debugId });
      return;
    }

    if (markdown.length > 200_000 || html.length > 400_000) {
      log("ERROR payload too large");
      res.status(413).json({ error: "Payload too large", debugId });
      return;
    }

    // Build HTML
    const tHtml0 = nowMs();
    const bodyHtml = html ? html : marked.parse(markdown, { gfm: true, breaks: true });
    const fullHtml = buildHtmlDocument({ title, logoUrl, bodyHtml });
    const tHtml1 = nowMs();

    log("HTML built", {
      bodyHtmlLen: bodyHtml.length,
      fullHtmlLen: fullHtml.length,
      buildMs: tHtml1 - tHtml0,
    });

    // Chromium config
    const headless =
      typeof chromium.headless === "boolean"
        ? chromium.headless
        : String(chromium.headless).toLowerCase() !== "false";

    const executablePath = await chromium.executablePath();

    log("Chromium config", {
      headless,
      executablePath,
      argsCount: Array.isArray(chromium.args) ? chromium.args.length : null,
      chromiumHeadlessType: typeof chromium.headless,
      chromiumHeadlessValue: chromium.headless,
    });

    // Launch Chromium
    const tLaunch0 = nowMs();
    browser = await playwrightChromium.launch({
      args: chromium.args,
      executablePath,
      headless,
    });
    const tLaunch1 = nowMs();

    log("Chromium launched", { launchMs: tLaunch1 - tLaunch0 });

    page = await browser.newPage();

    // Render
    const tContent0 = nowMs();
    await page.setContent(fullHtml, { waitUntil: "load" });
    const tContent1 = nowMs();

    log("setContent done", { setContentMs: tContent1 - tContent0 });

    // PDF
    const tPdf0 = nowMs();
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    const tPdf1 = nowMs();

    log("PDF generated", {
      pdfBytes: pdfBuffer?.length,
      pdfMs: tPdf1 - tPdf0,
      totalMs: tPdf1 - t0,
    });

    // Return
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(pdfBuffer);
  } catch (err) {
    log("ERROR", {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      totalMs: nowMs() - t0,
    });

    // Always return JSON with debugId so you can correlate logs
    res.status(500).json({ error: err?.message || "PDF generation failed", debugId });
  } finally {
    try {
      if (page) await page.close();
    } catch (e) {
      log("WARN page.close failed", e?.message || e);
    }
    try {
      if (browser) await browser.close();
    } catch (e) {
      log("WARN browser.close failed", e?.message || e);
    }
    log("END", { totalMs: nowMs() - t0 });
  }
}
