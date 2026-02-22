import { chromium as playwrightChromium } from "playwright-core";
import chromium from "@sparticuz/chromium";
import { marked } from "marked";

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

    const bodyHtml = body.html
      ? String(body.html)
      : marked.parse(String(body.markdown || ""), { gfm: true, breaks: true });

    const fullHtml = buildHtmlDocument({ title, logoUrl, bodyHtml });

    const browser = await playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true
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
