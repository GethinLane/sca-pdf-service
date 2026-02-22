(() => {
  function $(id) { return document.getElementById(id); }

  const cfg = {
    gradingBase: "https://voice-patient-web.vercel.app",
    pdfService: "https://sca-pdf-service.vercel.app/api/render-pdf",
    title: "Consultation Feedback Report",
    logoUrl:
      "https://images.squarespace-cdn.com/content/v1/647f7a4eb3767045e27d868d/455997f1-844a-4426-86dc-9973fac5e8e6/New+Logo.png?format=1500w",
  };

  async function fetchJson(url) {
    const resp = await fetch(url, { method: "GET", cache: "no-store", mode: "cors" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  async function postPdf(url, payload) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      let msg = `PDF service error (HTTP ${resp.status})`;
      try {
        const errJson = await resp.json();
        if (errJson?.error) msg = errJson.error;
      } catch {}
      throw new Error(msg);
    }

    return await resp.blob();
  }

  // Keep a persistent "last PDF" blob URL until replaced (prevents missing the download)
  let lastPdfUrl = null;

  function publishPdf(blob, filename) {
    // Revoke previous URL if we have one
    if (lastPdfUrl) {
      try { URL.revokeObjectURL(lastPdfUrl); } catch {}
      lastPdfUrl = null;
    }

    const url = URL.createObjectURL(blob);
    lastPdfUrl = url;

    // Optional: expose a "View last PDF" link if it exists on the page
    const link = $("lastPdfLink");
    if (link) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.style.display = ""; // if you hide it by default, it will show
    }

    // Open in a new tab so the user can see it immediately
    try { window.open(url, "_blank", "noopener"); } catch {}

    // Trigger download
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function getSessionId() {
    const qs = new URLSearchParams(window.location.search);
    return (qs.get("sessionId") || "").trim();
  }

  // Cache grading so download click is faster
  let cachedSessionId = "";
  let cachedGradingText = "";

  async function warmGradingCache() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    // If session changed, clear cache
    if (cachedSessionId !== sessionId) {
      cachedSessionId = sessionId;
      cachedGradingText = "";
    }

    if (cachedGradingText.trim()) return; // already cached

    const gradingUrl =
      `${cfg.gradingBase}/api/get-grading?sessionId=${encodeURIComponent(sessionId)}&force=1`;

    const t0 = performance.now();
    const gData = await fetchJson(gradingUrl);
    const t1 = performance.now();
    console.log("[pdf] grading prefetch ms:", Math.round(t1 - t0));

    const text = String(gData?.gradingText || "");
    if (text.trim()) cachedGradingText = text;
  }

  window.addEventListener("DOMContentLoaded", () => {
    const downloadBtn = $("downloadPdfBtn");
    const closeBtn = $("closeTabBtn");
    if (!downloadBtn) return;

    // Warm cache immediately, and retry once shortly after (grading may arrive a moment later)
    warmGradingCache().catch(() => {});
    setTimeout(() => warmGradingCache().catch(() => {}), 2500);

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        const openedByScript = window.opener && !window.opener.closed;
        window.close();
        if (!openedByScript) {
          alert("If this tab doesn't close automatically, your browser blocks it. Please close the tab manually.");
        }
      });
    }

    downloadBtn.addEventListener("click", async () => {
      const status = $("gradingStatus")?.textContent || "";
      if (status.toLowerCase().includes("loading") || status.toLowerCase().includes("progress")) {
        alert("Grading is still loading. Please wait until it says 'Grading ready'.");
        return;
      }

      const sessionId = getSessionId();
      if (!sessionId) {
        alert("Missing sessionId in the URL.");
        return;
      }

      // Ensure cache corresponds to this session
      if (cachedSessionId !== sessionId) {
        cachedSessionId = sessionId;
        cachedGradingText = "";
      }

      const filename = `grading-${sessionId}.pdf`;
      const gradingUrl =
        `${cfg.gradingBase}/api/get-grading?sessionId=${encodeURIComponent(sessionId)}&force=1`;

      const total0 = performance.now();

      try {
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Preparing PDF…";

        // 1) Get grading text (use cache if available)
        let gradingText = cachedGradingText;

        if (!gradingText.trim()) {
          downloadBtn.textContent = "Fetching grading…";
          const g0 = performance.now();
          const gData = await fetchJson(gradingUrl);
          const g1 = performance.now();
          console.log("[pdf] grading fetch ms:", Math.round(g1 - g0));

          gradingText = String(gData?.gradingText || "");
          if (!gradingText.trim()) throw new Error("Grading text was empty.");
          cachedGradingText = gradingText;
        }

        // 2) Generate PDF (server-side)
        downloadBtn.textContent = "Generating PDF…";
        const p0 = performance.now();
        const blob = await postPdf(cfg.pdfService, {
          markdown: gradingText,
          title: cfg.title,
          logoUrl: cfg.logoUrl,
          filename,
        });
        const p1 = performance.now();

        console.log("[pdf] pdf POST+blob ms:", Math.round(p1 - p0), "bytes:", blob.size);

        // 3) Publish (open tab + persistent link + download)
        publishPdf(blob, filename);

        console.log("[pdf] total click ms:", Math.round(performance.now() - total0));
      } catch (e) {
        console.error(e);
        alert(e?.message || "Couldn't generate the PDF. Try again.");
      } finally {
        downloadBtn.disabled = false;
        downloadBtn.textContent = "Download PDF";
      }
    });
  });
})();
