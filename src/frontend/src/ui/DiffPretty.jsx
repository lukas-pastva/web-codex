import React, { useEffect, useState } from 'react';

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default function DiffPretty({ diff, mode = "unified" }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const text = diff || "";
        if (!text.trim()) {
          if (mounted) setHtml("<em>No changes.</em>");
          return;
        }
        const mod = await import("diff2html");
        const Diff2Html = mod.Diff2Html || mod.default || mod;
        if (!Diff2Html || typeof Diff2Html.getPrettyHtml !== "function") {
          throw new Error("Diff2Html unavailable");
        }
        const css = document.getElementById("d2h-css");
        if (!css) {
          const link = document.createElement("link");
          link.id = "d2h-css";
          link.rel = "stylesheet";
          link.href = "https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css";
          document.head.appendChild(link);
        }
        const htmlStr = Diff2Html.getPrettyHtml(text, {
          inputFormat: "diff",
          showFiles: true,
          matching: "lines",
          outputFormat: mode === "side-by-side" ? "side-by-side" : "line-by-line"
        });
        if (mounted) setHtml(htmlStr);
      } catch (e) {
        try { console.error("DiffPretty failed:", e); } catch {}
        const fallback = `<em>Pretty diff failed to load. Showing raw.</em><pre class=\"diff\">${escapeHtml(diff || "")}</pre>`;
        if (mounted) setHtml(fallback);
      }
    })();
    return () => { mounted = false; };
  }, [diff, mode]);
  return <div className="pane" dangerouslySetInnerHTML={{ __html: html }} />;
}
