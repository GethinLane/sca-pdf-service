(() => {
  function $(id) { return document.getElementById(id); }

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

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.addEventListener("DOMContentLoaded", () => {
    const downloadBtn = $("downloadPdfBtn");
    const closeBtn = $("closeTabBtn");
    if (!downloadBtn) return;

    const cfg = {
      gradingBase: "https://voice-patient-web.vercel.app",
      pdfService: "https://sca-pdf-service.vercel.app/api/render-pdf",
      title: "Consultation Feedback Report",
      logoUrl:
        "https://images.squarespace-cdn.com/content/v1/647f7a4eb3767045e27d868d/455997f1-844a-4426-86dc-9973fac5e8e6/New+Logo.png?format=1500w",
    };

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

      const qs = new URLSearchParams(window.location.search);
      const sessionId = (qs.get("sessionId") || "").trim();
      if (!sessionId) {
        alert("Missing sessionId in the URL.");
        return;
      }

      const filename = `grading-${sessionId}.pdf`;
      const gradingUrl = `${cfg.gradingBase}/api/get-grading?sessionId=${encodeURIComponent(sessionId)}&force=1`;

      try {
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Preparing PDF…";

        const gData = await fetchJson(gradingUrl);
        const gradingText = String(gData?.gradingText || "");
        if (!gradingText.trim()) throw new Error("Grading text was empty.");

        const blob = await postPdf(cfg.pdfService, {
          markdown: gradingText,
          title: cfg.title,
          logoUrl: cfg.logoUrl,
          filename,
        });

        downloadBlob(blob, filename);
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
