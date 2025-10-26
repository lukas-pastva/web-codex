import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function CodexTerminal({ repoPath, onClose }) {
  const ref = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: 14 });
    termRef.current = term;
    term.open(ref.current);
    term.writeln('\x1b[1;34mweb-codex\x1b[0m — attaching to Codex CLI...');
    const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?repoPath=${encodeURIComponent(repoPath||'')}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => term.write(ev.data);
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
            <button className="secondary" onClick={()=>termRef.current && termRef.current.setOption("fontSize", (termRef.current.getOption("fontSize")||14)+1)}>A+</button>
            <button className="secondary" style={{marginLeft:6}} onClick={()=>termRef.current && termRef.current.setOption("fontSize", Math.max(10,(termRef.current.getOption("fontSize")||14)-1))}>A-</button>
          </span>
        </div>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <div ref={ref} className="term" />
    </div>
  );
}