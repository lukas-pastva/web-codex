import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function CodexTerminal({ repoPath, onClose }) {
  const ref = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const [wrapCR, setWrapCR] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('termWrapCR') !== '0' : true));
  const wrapRef = useRef(wrapCR);
  useEffect(() => { wrapRef.current = wrapCR; try { localStorage.setItem('termWrapCR', wrapCR ? '1' : '0'); } catch {} }, [wrapCR]);

  useEffect(() => {
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: 14 });
    termRef.current = term;
    term.open(ref.current);
    term.writeln('\x1b[1;34mweb-codex\x1b[0m — attaching to Codex CLI...');
    const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?repoPath=${encodeURIComponent(repoPath||'')}`);
    wsRef.current = ws;
    // Normalize progress lines conditionally to avoid overwriting
    const normalize = (s) => {
      if (!wrapRef.current) return s;
      // 1) collapse CRLF to LF; 2) turn any remaining CR into LF to avoid overwrites
      return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    };
    ws.onmessage = (ev) => {
      let s = typeof ev.data === 'string' ? ev.data : String(ev.data);
      s = normalize(s);
      term.write(s);
    };
    ws.onclose = () => term.writeln('\r\n[session closed]\r\n');
    term.onData(data => ws.readyState === 1 && ws.send(data));
    return () => { try { ws.close(); } catch {}; term.dispose(); };
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
              }}
            >A-</button>
            <button
              className="secondary icon"
              style={{ marginLeft: 6 }}
              onClick={() => setWrapCR(v => !v)}
              title={`Wrap progress lines (CR→LF): ${wrapCR ? 'on' : 'off'}`}
            >⤶</button>
          </span>
        </div>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <div ref={ref} className="term" />
    </div>
  );
}
