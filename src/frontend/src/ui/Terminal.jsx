import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function CodexTerminal({ repoPath }) {
  const ref = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);

  const copySelectionUnwrapped = async () => {
    try {
      const t = termRef.current;
      let text = '';
      if (t && typeof t.getSelection === 'function') {
        text = t.getSelection() || '';
      }
      if (!text && typeof window !== 'undefined' && window.getSelection) {
        text = String(window.getSelection()?.toString() || '');
      }
      if (!text && ref.current) {
        try {
          const rows = ref.current.querySelectorAll('.xterm-rows > div');
          if (rows && rows.length) {
            text = Array.from(rows).map(r => r.textContent || '').join('\n');
          }
        } catch {}
      }
      if (!text) return;
      // Strip ANSI escapes, CR, and join all newlines (soft wraps) without spaces
      const ansiRe = /\x1b\[[0-9;]*[A-Za-z]/g;
      const out = text.replace(ansiRe, '').replace(/\r/g, '').replace(/\n+/g, '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(out);
      } else {
        const ta = document.createElement('textarea');
        ta.value = out; ta.style.position = 'fixed'; ta.style.left = '-1000px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
    } catch {}
  };

  const pasteFromClipboard = async () => {
    try {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      let text = '';
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          text = await navigator.clipboard.readText();
        } catch (e) {
          // fall through to manual prompt
        }
      }
      if (!text) {
        // Fallback prompt for environments where clipboard read is blocked
        // eslint-disable-next-line no-alert
        const manual = window.prompt('Paste text to send to terminal:');
        if (manual) text = manual;
      }
      if (!text) return;
      ws.send(text);
    } catch {}
  };

  useEffect(() => {
    // Smaller default font on mobile; slightly smaller in general
    const baseFontSize = (() => {
      try {
        return (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) ? 12 : 13;
      } catch { return 13; }
    })();
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: baseFontSize });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    termRef.current = term;
    term.open(ref.current);
    // Fit to container after mount
    try { fit.fit(); } catch {}
    // Refit on window resize
    const onResize = () => { try { fitRef.current && fitRef.current.fit(); } catch {} };
    window.addEventListener('resize', onResize);
    term.writeln('\x1b[1;34mweb-codex\x1b[0m — attaching to Codex CLI...');
    const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?repoPath=${encodeURIComponent(repoPath||'')}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      let s = typeof ev.data === 'string' ? ev.data : String(ev.data);
      term.write(s);
    };
    ws.onclose = () => term.writeln('\r\n[session closed]\r\n');
    term.onData(data => ws.readyState === 1 && ws.send(data));
    return () => { try { ws.close(); } catch {}; window.removeEventListener('resize', onResize); term.dispose(); };
  }, [repoPath]);

  return (
    <div className="pane">
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
        <div className="muted" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>Codex Chat (interactive terminal)</span>
          <span>
            <button
              className="secondary"
              onClick={() => {
                const t = termRef.current; if (!t) return;
                const cur = Number(t.options?.fontSize || 14);
                t.options.fontSize = cur + 1;
                try { fitRef.current && fitRef.current.fit(); } catch {}
              }}
            >A+</button>
            <button
              className="secondary"
              style={{ marginLeft: 6 }}
              onClick={() => {
                const t = termRef.current; if (!t) return;
                const cur = Number(t.options?.fontSize || 14);
                const next = Math.max(10, cur - 1);
                t.options.fontSize = next;
                try { fitRef.current && fitRef.current.fit(); } catch {}
              }}
            >A-</button>
            <button
              className="secondary icon"
              style={{ marginLeft: 6 }}
              onClick={copySelectionUnwrapped}
              title="Copy selection without line wraps"
            >📋</button>
            <button
              className="secondary icon"
              style={{ marginLeft: 6 }}
              onClick={pasteFromClipboard}
              title="Paste clipboard into terminal"
            >📥</button>
          </span>
        </div>
        <div></div>
      </div>
      <div ref={ref} className="term" />
    </div>
  );
}
