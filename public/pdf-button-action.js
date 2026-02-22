// public/pdf-button-action.v3.js
(() => {
  function $(id) {
    return document.getElementById(id);
  }

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

  function getSessionId() {
    const qs = new URLSearchParams(window.location.search);
    return (qs.get("sessionId") || "").trim();
  }

  // Keep last PDF alive in THIS TAB until replaced, so users can "view again"
  let lastPdfUrl = null;

  function publishPdf(blob, filename) {
    // Replace any previous blob URL
    if (lastPdfUrl) {
      try {
        URL.revokeObjectURL(lastPdfUrl);
      } catch {}
      lastPdfUrl = null;
    }

    const url = URL.createObjectURL(blob);
    lastPdfUrl = url;

    // Optional: expose a "View last PDF" link if present on the page
    const link = $("lastPdfLink");
    if (link) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      // if you hide it by default, this will show it
      link.style.display = "";
    }

    // Open so the user sees it immediately
    try {
      window.open(url, "_blank", "noopener");
    } catch {}

    // Also trigger download
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Cache grading ONLY after first click (no load-time prefetch, avoids slowing grading display)
  let cachedSessionId = "";
  let cachedGradingText = "";

  window.addEventListener("DOMContentLoaded", () => {
    const downloadBtn = $("downloadPdfBtn");
    const closeBtn = $("closeTabBtn");
    if (!downloadBtn) return;

    // Close tab (reliable only if opened by JS)
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        const openedByScript = window.opener && !window.opener.closed;
        window.close();
        if (!openedByScript) {
          alert(
            "If this tab doesn't close automatically, your browser blocks it. Please close the tab manually."
          );
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
      const gradingUrl = `${cfg.gradingBase}/api/get-grading?sessionId=${encodeURIComponent(
        sessionId
      )}&force=1`;

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
          console.log("[pdf] grading fetch ms:", Math.round(g1 - g0), "status ok");

          gradingText = String(gData?.gradingText || "");
          if (!gradingText.trim()) throw new Error("Grading text was empty.");

          cachedGradingText = gradingText;
        }

        // 2) Generate PDF (server-side, real text)
        downloadBtn.textContent = "Generating PDF…";
        const p0 = performance.now();
        const blob = await postPdf(cfg.pdfService, {
          markdown: gradingText,
          title: cfg.title,
          logoUrl: cfg.logoUrl,
          filename,
        });
        const p1 = performance.now();

        console.log("[pdf] pdf request+blob ms:", Math.round(p1 - p0), "bytes:", blob.size);
        console.log("[pdf] total click ms:", Math.round(performance.now() - total0));

        // 3) Open tab + optional "View last PDF" link + download
        publishPdf(blob, filename);
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
