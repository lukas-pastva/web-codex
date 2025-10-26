import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import CodexTerminal from "./Terminal.jsx";
import FileTree from "./FileTree.jsx";
import DiffPretty from "./DiffPretty.jsx";
import HelpModal from "./HelpModal.jsx";
import { ToastProvider, useToast } from "./ToastContext.jsx";

function GroupTabs({ providers, current, setCurrent }) {
  const items = [];
  if (providers.github) {
    for (const key of Object.keys(providers.github)) items.push({ provider: "github", key });
  }
  if (providers.gitlab) {
    for (const key of Object.keys(providers.gitlab)) items.push({ provider: "gitlab", key });
  }
  return (
    <div className="tabs">
      {items.map((it, idx) => {
        const id = `${it.provider}:${it.key}`;
        const active = current === id;
        return (
          <div key={idx} className={"tab " + (active ? "active" : "")} onClick={() => setCurrent(id)}>
            {it.provider} / {it.key}
          </div>
        );
      })}
    </div>
  );
}

function RepoList({ repos, onSelect, favs, toggleFav }) {
  const sorted = [...repos].sort((a,b)=>{
    const af = favs.includes(a.full_name||a.path_with_namespace);
    const bf = favs.includes(b.full_name||b.path_with_namespace);
    return af===bf ? 0 : (af?-1:1);
  });
  return (
    <div className="pane">
      {sorted.map((r, i) => (
        <div key={i} className="repo" onClick={() => onSelect(r)} style={{cursor:'pointer'}}>
          <div>
            <div><strong>{r.name}</strong></div>
            <div className="muted">{r.full_name || r.path_with_namespace}</div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button className="secondary" onClick={(e)=>{e.stopPropagation(); toggleFav(r.full_name||r.path_with_namespace);}}>{favs.includes(r.full_name||r.path_with_namespace)?'⭐':'☆'}</button>
            <button onClick={(e) => { e.stopPropagation(); onSelect(r); }}>Open</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function RepoActions({ repo, meta, setMeta, onToggleHelp }) {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [current, setCurrent] = useState("");
  const [log, setLog] = useState([]);
  const [patch, setPatch] = useState("");
  const [message, setMessage] = useState("codex-" + new Date().toISOString());
  const [showPretty, setShowPretty] = useState(false);
  const [openFile, setOpenFile] = useState(null);
  const [openFileContent, setOpenFileContent] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSeconds, setRefreshSeconds] = useState(5);
  const [showCommitCount, setShowCommitCount] = useState(1);

  const loadBranches = async () => {
    const r = await axios.get("/api/git/branches", { params: { repoPath: meta.repoPath }});
    setBranches(r.data.all || []);
    setCurrent(r.data.current || "");
  };

  const refreshLog = async () => {
    const r = await axios.get("/api/git/log", { params: { repoPath: meta.repoPath }});
    setLog(r.data.commits || []);
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const typing = e.target?.isContentEditable || ['input','textarea','select','button'].includes(tag);
      if (typing) return; // ignore shortcuts while typing / interacting with controls
      if (e.key === 'p') { e.preventDefault(); doPull(); }
      if (e.key === 'b') { e.preventDefault(); const el = document.getElementById('branch-select'); el && el.focus(); }
      // terminal is always visible; no 't' toggle
      if (e.key === 'd') { e.preventDefault(); refreshDiff(); }
      if (e.key === '?') { e.preventDefault(); onToggleHelp && onToggleHelp(); }
      if (e.key === 'c') { e.preventDefault(); doApplyCommitPush(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (meta.repoPath) {
      loadBranches();
      refreshLog();
    }
  }, [meta.repoPath]);

  // Terminal is always visible

  const doPull = async () => {
    await axios.post("/api/git/pull", { repoPath: meta.repoPath });
    await refreshLog();
    toast("Pulled latest ✅");
  };

  const doCheckout = async (b) => {
    await axios.post("/api/git/checkout", { repoPath: meta.repoPath, branch: b });
    await loadBranches();
    await refreshDiff();
  };

  const refreshDiff = async () => {
    if (!meta.repoPath) return;
    const r = await axios.get("/api/git/diff", { params: { repoPath: meta.repoPath } });
    setPatch(r.data.diff || "");
  };

  // Auto refresh diff
  useEffect(() => {
    if (!autoRefresh || !meta.repoPath) return;
    const ms = Math.max(2000, Number(refreshSeconds) * 1000 || 5000);
    const id = setInterval(() => { refreshDiff().catch(()=>{}); }, ms);
    return () => clearInterval(id);
  }, [autoRefresh, refreshSeconds, meta.repoPath]);

  const doApplyCommitPush = async () => {
    await axios.post("/api/git/commitPush", { repoPath: meta.repoPath, message });
    await refreshLog();
    await refreshDiff();
    toast("Pushed ✅");
  };

  const copyHash = async (hash) => {
    try {
      await navigator.clipboard.writeText(hash);
      toast("Commit hash copied ✅");
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = hash;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast("Commit hash copied ✅");
      } catch {
        alert("Failed to copy commit hash");
      }
    }
  };

  return (
    <div className="row">
      <div className="col">
        <div className="pane">
          <div className="actions" style={{marginBottom:8, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            <button className="secondary" onClick={doPull}>git pull</button>
            <select id="branch-select" value={current} onChange={e => doCheckout(e.target.value)}>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <input placeholder="commit message" value={message} onChange={e=>setMessage(e.target.value)} style={{minWidth:220}}/>
            <button onClick={doApplyCommitPush}>Apply & Push</button>
          </div>
        </div>

        <FileTree repoPath={meta.repoPath} onOpen={async (p)=>{ const r=await axios.get("/api/git/file",{params:{repoPath:meta.repoPath,path:p}}); setOpenFile(p); setOpenFileContent(r.data.text||""); }} />
        <div className="pane" style={{marginTop:16}}>
          <div className="muted" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>{showCommitCount === 1 ? 'Last commit' : `Last ${showCommitCount} commits`}</span>
            <span>
              {log.length > showCommitCount && (
                <button className="secondary icon" onClick={() => setShowCommitCount(c => Math.min(log.length, c + 10))} title="Show more commits">+</button>
              )}
            </span>
          </div>
          <div className="commit-list">
            {log.slice(0, showCommitCount).map(c => (
              <div key={c.hash} className="repo">
                <div>
                  <div><strong>{c.message}</strong></div>
                  <div className="muted">{c.hash.slice(0,8)} · {new Date(c.date).toLocaleString()}</div>
                </div>
                <div style={{display:'flex', gap:8, alignItems:'center'}}>
                  <button className="secondary" onClick={() => copyHash(c.hash)} title="Copy full commit hash">copy hash</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="col">
        <CodexTerminal repoPath={meta.repoPath} />
        <div className="pane">
          <div className="muted" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Patch preview</span>
            <span>
              <label style={{display:"inline-flex",alignItems:"center",gap:6}}>
                <input type="checkbox" checked={autoRefresh} onChange={e=>setAutoRefresh(e.target.checked)} />
                Auto refresh
              </label>
              <input type="number" min="2" max="60" value={refreshSeconds} onChange={e=>setRefreshSeconds(e.target.value)} style={{width:70, marginLeft:8}} /> s
            </span>
          </div>
          {showPretty ? <DiffPretty diff={patch} /> : <code className="diff">{patch || "No patch yet"}</code>}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [phase, setPhase] = useState("repos"); // repos only
  const [providers, setProviders] = useState({ github: {}, gitlab: {} });
  const [favs, setFavs] = useState(() => JSON.parse(localStorage.getItem("favs")||"[]"));
  const [showHelp, setShowHelp] = useState(false);
  const [activePane, setActivePane] = useState("actions"); // actions | terminal | diff | files
  const [current, setCurrent] = useState("");
  const [currentRepo, setCurrentRepo] = useState(null);
  const [meta, setMeta] = useState({ repoPath: "" });
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('themeMode') || 'auto'); // auto | dark | light
  const [loadingRepos, setLoadingRepos] = useState(false);
  const routeRef = useRef({});
  const [pendingRepoId, setPendingRepoId] = useState("");

  const handleBackToGroup = () => {
    setCurrentRepo(null);
    setMeta({ repoPath: "" });
    // ensure URL drops the repo param immediately
    updateHashFromState('repos', current, null);
  };

  const handleGoHome = () => {
    setPhase('repos');
    setCurrentRepo(null);
    setMeta({ repoPath: "" });
    updateHashFromState('repos', current, null);
  };

  // --- Simple hash router ---
  function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (!h) return { page: 'repos' };
    const [page, qs] = h.split('?');
    const params = {};
    if (qs) {
      for (const part of qs.split('&')) {
        const [k, v=''] = part.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v);
      }
    }
    return { page: page || 'repos', params };
  }
  function buildHash(next) {
    const { page = 'repos', params = {} } = next || {};
    const qs = Object.entries(params)
      .filter(([,v]) => v !== undefined && v !== '' && v !== null)
      .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `#${page}${qs ? '?' + qs : ''}`;
  }
  function updateHashFromState(p = phase, cur = current, repo = currentRepo) {
    const params = {};
    if (p === 'repos') {
      const [prov, key] = (cur||'').split(':');
      if (prov) params.provider = prov;
      if (key) params.key = key;
      if (repo) {
        const id = repo.full_name || repo.path_with_namespace || repo.name;
        if (id) params.repo = id;
      }
    }
    const target = buildHash({ page: p, params });
    if (location.hash !== target) location.hash = target;
  }
  function applyRoute(route) {
    routeRef.current = route;
    const { page, params } = route;
    setPhase('repos');
    if (page === 'repos') {
      const prov = params?.provider;
      const key = params?.key;
      if (prov && key) setCurrent(`${prov}:${key}`);
      const rid = params?.repo || '';
      if (!rid) { setCurrentRepo(null); setMeta({ repoPath: '' }); setPendingRepoId(''); }
      else setPendingRepoId(rid);
    }
  }

  // Initial route parse
  useEffect(() => {
    applyRoute(parseHash());
    const onHash = () => applyRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    localStorage.setItem('themeMode', themeMode);
    const root = document.documentElement;
    if (themeMode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  const cycleTheme = () => setThemeMode(m => m === 'auto' ? 'dark' : (m === 'dark' ? 'light' : 'auto'));
  const themeIcon = themeMode === 'auto' ? '🖥️' : (themeMode === 'dark' ? '🌙' : '☀️');

  // CLI-only mode: no config fetch needed

  const load = async () => {
    setLoadingRepos(true);
    try {
      const r = await axios.get("/api/providers");
      setProviders(r.data);
      const route = routeRef.current || {};
      const prov = route.params?.provider;
      const key = route.params?.key;
      const repoId = route.params?.repo;
      if (prov && key) setCurrent(`${prov}:${key}`);
      else {
        const gh = Object.keys(r.data.github || {})[0];
        const gl = Object.keys(r.data.gitlab || {})[0];
        const first = gh ? `github:${gh}` : (gl ? `gitlab:${gl}` : "");
        if (first) setCurrent(first);
      }
      // If route includes a repo, open it after providers load
      if (prov && key && (repoId || pendingRepoId)) {
        const want = repoId || pendingRepoId;
        const group = r.data[prov]?.[key] || [];
        const match = group.find(item => (item.full_name || item.path_with_namespace || item.name) === want);
        if (match) {
          await openRepo(match, prov, key); // pass explicit to avoid race with current
          setPendingRepoId('');
        }
      }
    } finally {
      setLoadingRepos(false);
    }
  };

  // If route changes after providers already loaded, try to open/close accordingly
  useEffect(() => {
    const route = routeRef.current || {};
    if (phase !== 'repos') return;
    const prov = route.params?.provider;
    const key = route.params?.key;
    const rid = route.params?.repo || pendingRepoId;
    if (!prov || !key) return;
    const group = providers[prov]?.[key] || [];
    if (!rid) {
      setCurrentRepo(null); setMeta({ repoPath: '' }); return;
    }
    const match = group.find(item => (item.full_name || item.path_with_namespace || item.name) === rid);
    if (match && (!currentRepo || (currentRepo.full_name||currentRepo.path_with_namespace||currentRepo.name)!==rid)) {
      openRepo(match, prov, key).then(()=> setPendingRepoId('')).catch(()=>{});
    }
  }, [providers, current, phase, pendingRepoId]);
  useEffect(() => { if (phase === "repos") load(); }, [phase]);

  // If user switches group tabs while a repo is open, go back to the group list
  useEffect(() => {
    if (currentRepo) {
      setCurrentRepo(null);
      setMeta({ repoPath: '' });
      updateHashFromState('repos', current, null);
    }
  }, [current]);

  const reposForCurrent = useMemo(() => {
    if (!current) return [];
    const [provider, key] = current.split(":");
    const group = providers[provider]?.[key] || [];
    return group;
  }, [providers, current]);

  const openRepo = async (repo, providerOverride, keyOverride) => {
    setCurrentRepo(repo);
    // Derive provider & owner from full_name/path
    const [providerAuto, keyAuto] = (current || '').split(":");
    const provider = providerOverride || providerAuto;
    const key = keyOverride || keyAuto;
    const owner = (repo.full_name || repo.path_with_namespace || "").split("/")[0];
    const name = repo.name;
    const clone_url = repo.clone_url || repo.http_url_to_repo;
    const r = await axios.post("/api/git/clone", { provider, owner, name, clone_url });
    setMeta({ repoPath: r.data.repoPath, provider, owner, name, clone_url });
  };

  // Keep URL in sync with state for bookmarking
  useEffect(() => {
    updateHashFromState();
  }, [phase, current, currentRepo]);

  return (
    <div>
      <header>
        <div style={{cursor:'pointer'}} onClick={handleGoHome} title="Home (repos)"><strong>web-codex</strong></div>
        
        <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
          <button
            className="secondary icon"
            onClick={() => setShowHelp(true)}
            title={"Shortcuts: p pull, b branch, d diff, c commit. Disabled while typing. Press ? for full help."}
          >⌨️</button>
          <button className="secondary icon" onClick={cycleTheme} title={`Theme: ${themeMode}`}>{themeIcon}</button>
        </div>
      </header>
      <div className="container">
        <GroupTabs providers={providers} current={current} setCurrent={setCurrent} />
        {!currentRepo ? (
          loadingRepos ? (
            <div className="pane"><div className="muted">Loading repos…</div></div>
          ) : (
            <RepoList
              repos={reposForCurrent}
              onSelect={openRepo}
              favs={favs}
              toggleFav={(full)=>{const next=favs.includes(full)?favs.filter(f=>f!==full):[...favs,full]; setFavs(next); localStorage.setItem('favs', JSON.stringify(next));}}
            />
          )
        ) : (
          <>
            <div className="pane" style={{marginBottom:12}}>
              <div className="actions" style={{display:'flex',alignItems:'center',gap:8}}>
                <button className="secondary" onClick={handleBackToGroup}>← Back to group</button>
                <div className="muted">
                  {(() => { const [prov, key] = (current||'').split(':'); return `${prov||''}${key? ' / ' + key : ''}`; })()}
                  {currentRepo ? ` / ${currentRepo.name}` : ''}
                </div>
              </div>
            </div>
            <RepoActions
              repo={currentRepo}
              meta={meta}
              setMeta={setMeta}
              onToggleHelp={() => setShowHelp(h => !h)}
            />
          </>
        )}
      </div>
      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
