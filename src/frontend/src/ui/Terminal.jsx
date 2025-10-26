import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function CodexTerminal({ repoPath }) {
  const ref = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  // Default OFF (raw PTY behavior). User can enable if they prefer line-per-update.
  const [wrapCR, setWrapCR] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    const v = localStorage.getItem('termWrapCR');
    return v === '1' ? true : false;
  });
  const wrapRef = useRef(wrapCR);
  useEffect(() => { wrapRef.current = wrapCR; try { localStorage.setItem('termWrapCR', wrapCR ? '1' : '0'); } catch {} }, [wrapCR]);

  const resetTerminalSettings = () => {
    try { localStorage.removeItem('termWrapCR'); } catch {}
    setWrapCR(false);
    const t = termRef.current;
    if (t && t.options) {
      t.options.fontSize = 14;
    }
  };

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

  useEffect(() => {
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: 14 });
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
    // Minimal normalization only when enabled: CR (without LF) -> CRLF
    const normalize = (s) => {
      if (!wrapRef.current) return s; // raw PTY stream
      return s.replace(/\r(?!\n)/g, '\r\n');
    };
    ws.onmessage = (ev) => {
      let s = typeof ev.data === 'string' ? ev.data : String(ev.data);
      s = normalize(s);
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
              className={"secondary icon " + (wrapCR ? 'active' : '')}
              style={{ marginLeft: 6 }}
              onClick={() => setWrapCR(v => !v)}
              title={`Wrap progress lines (CR→LF): ${wrapCR ? 'on' : 'off'}`}
              aria-pressed={wrapCR}
            >⤶</button>
            <button
              className="secondary icon"
              style={{ marginLeft: 6 }}
              onClick={copySelectionUnwrapped}
              title="Copy selection without line wraps"
            >📋</button>
            <button
              className="secondary icon"
              style={{ marginLeft: 6 }}
              onClick={resetTerminalSettings}
              title="Reset terminal settings (font size, wrap)"
            >♻️</button>
          </span>
        </div>
      </div>
      <div ref={ref} className="term" />
    </div>
  );
}
