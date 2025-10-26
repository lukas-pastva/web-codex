import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function FileTree({ repoPath, onOpen }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!repoPath) return;
    axios.get('/api/git/tree', { params: { repoPath, depth: 6, max: 2000 } })
      .then(r => setItems(r.data.files || []))
      .catch(()=> setItems([]));
  }, [repoPath]);

  const filtered = items.filter(i => (i.path||'').toLowerCase().includes(q.toLowerCase())).slice(0, 500);

  return (
    <div className="pane">
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
        <input placeholder="Filter files..." value={q} onChange={e=>setQ(e.target.value)} />
      </div>
      <div style={{maxHeight:'40vh',overflow:'auto'}}>
        {filtered.map((f,i)=>(
          <div key={i} className="repo" onClick={()=> f.type==='file' && onOpen(f.path)} style={{cursor: f.type==='file'?'pointer':'default'}}>
            <div><strong>{f.name}</strong> <span className="muted">({f.type})</span></div>
            <div className="muted">{f.path}</div>
          </div>
        ))}
      </div>
    </div>
  );
}