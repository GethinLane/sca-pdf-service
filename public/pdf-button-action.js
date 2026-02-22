// public/pdf-button-action.v4.js
(() => {
  function $(id) { return document.getElementById(id); }

  const cfg = {
    pdfService: "https://sca-pdf-service.vercel.app/api/render-pdf",
    title: "Consultation Feedback Report",
    logoUrl:
      "https://images.squarespace-cdn.com/content/v1/647f7a4eb3767045e27d868d/455997f1-844a-4426-86dc-9973fac5e8e6/New+Logo.png?format=1500w",

    // Auto-expire the in-tab PDF after X minutes (so UI can revert to "Create PDF")
    // Set to 0 to disable auto-expire (it will persist until tab closes / refresh).
    expireMinutes: 30,
  };

  function getSessionId() {
    const qs = new URLSearchParams(window.location.search);
    return (qs.get("sessionId") || "").trim();
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

  // --- PDF availability state (per tab) ---
  let lastPdfUrl = null;
  let lastPdfFilename = null;
  let expireTimer = null;

  function pdfIsAvailable() {
    return !!lastPdfUrl;
  }

  function revokePdf() {
    if (expireTimer) {
      clearTimeout(expireTimer);
      expireTimer = null;
    }

    if (lastPdfUrl) {
      try { URL.revokeObjectURL(lastPdfUrl); } catch {}
    }
    lastPdfUrl = null;
    lastPdfFilename = null;

    // Hide optional link
    const link = $("lastPdfLink");
    if (link) link.style.display = "none";

    syncButtonUI();
  }

  function setPdfAvailable(url, filename) {
    // replace any previous
    if (lastPdfUrl) {
      try { URL.revokeObjectURL(lastPdfUrl); } catch {}
    }
    lastPdfUrl = url;
    lastPdfFilename = filename;

    // Optional "View last PDF" link on page
    const link = $("lastPdfLink");
    if (link) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.style.display = ""; // show
    }

    // Auto-expire (optional)
    if (expireTimer) clearTimeout(expireTimer);
    if (cfg.expireMinutes && cfg.expireMinutes > 0) {
      expireTimer = setTimeout(() => revokePdf(), cfg.expireMinutes * 60 * 1000);
    }

    syncButtonUI();
  }

  function openAndDownloadExistingPdf() {
    if (!lastPdfUrl || !lastPdfFilename) return;

    // Open in new tab for viewing
    try { window.open(lastPdfUrl, "_blank", "noopener"); } catch {}

    // Trigger download too
    const a = document.createElement("a");
    a.href = lastPdfUrl;
    a.download = lastPdfFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function syncButtonUI() {
    const btn = $("downloadPdfBtn");
    if (!btn) return;

    if (pdfIsAvailable()) {
      btn.textContent = "Download PDF";
      btn.dataset.mode = "view";
    } else {
      btn.textContent = "Create PDF";
      btn.dataset.mode = "create";
    }
  }

  async function createPdf() {
    const btn = $("downloadPdfBtn");
    if (!btn) return;

    const sessionId = getSessionId();
    if (!sessionId) {
      alert("Missing sessionId in the URL.");
      return;
    }

    // Use the grading text already fetched for display by grading-page.js
    const gradingText = String(window.__gradingText || "");
    const ready = !!window.__gradingReady;

    if (!ready || !gradingText.trim()) {
      alert("Grading isn't ready yet.");
      return;
    }

    const filename = `grading-${sessionId}.pdf`;

    try {
      btn.disabled = true;
      btn.textContent = "Creating PDF…";

      const t0 = performance.now();
      const blob = await postPdf(cfg.pdfService, {
        markdown: gradingText,
        title: cfg.title,
        logoUrl: cfg.logoUrl,
        filename,
      });
      const t1 = performance.now();
      console.log("[pdf] create ms:", Math.round(t1 - t0), "bytes:", blob.size);

      const url = URL.createObjectURL(blob);
      setPdfAvailable(url, filename);

      // Immediately open + download once created
      openAndDownloadExistingPdf();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Couldn't generate the PDF. Try again.");
      // If creation failed, make sure UI returns to Create
      revokePdf();
    } finally {
      btn.disabled = false;
      syncButtonUI();
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const btn = $("downloadPdfBtn");
    const closeBtn = $("closeTabBtn");
    if (!btn) return;

    // Initial UI state
    syncButtonUI();

    // Close tab
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        const openedByScript = window.opener && !window.opener.closed;
        window.close();
        if (!openedByScript) {
          alert("If this tab doesn't close automatically, your browser blocks it. Please close the tab manually.");
        }
      });
    }

    // Button behavior depends on state
    btn.addEventListener("click", async () => {
      if (pdfIsAvailable()) {
        openAndDownloadExistingPdf();
        return;
      }
      await createPdf();
    });

    // Optional: if you want it to revert immediately when user refreshes grading, you can
    // call revokePdf() manually from elsewhere. By default it persists until refresh/tab close or expireMinutes.
  });
})();
