import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import CodexTerminal from "./Terminal.jsx";
import FileTree from "./FileTree.jsx";
import DiffPretty from "./DiffPretty.jsx";
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
        const count = (providers[it.provider]?.[it.key] || []).length;
        return (
          <div
            key={idx}
            className={"tab " + (active ? "active" : "")}
            onClick={() => setCurrent(id)}
            aria-current={active ? 'page' : undefined}
            title={`${it.provider} / ${it.key}`}
          >
            {active && <span className="current-dot" />}
            <span style={{fontWeight: active ? 600 : 500}}>{it.provider} / {it.key}</span>
            <span className="tag" style={{marginLeft: 6}}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function RepoList({ repos, onSelect, currentId }) {
  const [q, setQ] = useState("");
  const sorted = [...repos].sort((a,b)=>{
    const an = (a.name || '').toLowerCase();
    const bn = (b.name || '').toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
  const ql = (q || '').trim().toLowerCase();
  const filtered = ql
    ? sorted.filter(r => {
        const fields = [r.name, r.full_name, r.path_with_namespace];
        return fields.some(v => (v || '').toLowerCase().includes(ql));
      })
    : sorted;
  return (
    <div className="pane">
      <input
        placeholder="Search repos..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {filtered.map((r, i) => (
        <div key={i} className="repo" onClick={() => onSelect(r)} style={{cursor:'pointer'}}>
          <div>
            <div><strong>{r.name}</strong></div>
            <div className="muted">{r.full_name || r.path_with_namespace}</div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button onClick={(e) => { e.stopPropagation(); onSelect(r); }}>Open</button>
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="muted">No repos match your search</div>
      )}
    </div>
  )
}

function RepoActions({ repo, meta, setMeta }) {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [current, setCurrent] = useState("");
  const [log, setLog] = useState([]);
  const [patch, setPatch] = useState("");
  const [message, setMessage] = useState("codex-" + new Date().toISOString());
  const [showPretty, setShowPretty] = useState(false);
  const [openFile, setOpenFile] = useState(null);
  const [openFileContent, setOpenFileContent] = useState("");
  // Always auto-refresh patch every 5 seconds (mobile-friendly)
  const [pullInfo, setPullInfo] = useState({ at: null, upToDate: null, behind: 0 });
  const [pushing, setPushing] = useState(false);
  // Only show the latest commit
  const [changedFiles, setChangedFiles] = useState([]);
  const [showAllChanged, setShowAllChanged] = useState(false);
  // Copy feedback state for the copy-hash button
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);

  const loadBranches = async () => {
    const r = await axios.get("/api/git/branches", { params: { repoPath: meta.repoPath }});
    setBranches(r.data.all || []);
    setCurrent(r.data.current || "");
  };

  const refreshLog = async () => {
    const r = await axios.get("/api/git/log", { params: { repoPath: meta.repoPath }});
    setLog(r.data.commits || []);
  };
  const refreshStatus = async () => {
    const r = await axios.get("/api/git/status", { params: { repoPath: meta.repoPath }});
    const behind = Number(r.data.status?.behind || 0);
    setPullInfo(p => ({ ...p, upToDate: behind === 0, behind }));
  };

  // Keyboard shortcuts removed for simplicity and mobile friendliness

  useEffect(() => {
    if (meta.repoPath) {
      loadBranches();
      refreshLog();
      refreshStatus();
      refreshDiff();
    }
  }, [meta.repoPath]);

  // Terminal is always visible

  const doPull = async () => {
    const r = await axios.post("/api/git/pull", { repoPath: meta.repoPath });
    const up = Boolean(r.data?.status?.upToDate);
    const behind = Number(r.data?.status?.after?.behind || 0);
    setPullInfo({ at: new Date().toISOString(), upToDate: up, behind });
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

  // Parse changed files from unified diff
  useEffect(() => {
    try {
      const diff = patch || '';
      const lines = diff.split(/\n/);
      const out = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
        if (m) {
          let from = m[1];
          let to = m[2];
          let status = 'modified';
          let j = i + 1;
          while (j < lines.length && !lines[j].startsWith('diff --git ')) {
            const l = lines[j];
            if (/^new file mode /.test(l)) status = 'added';
            if (/^deleted file mode /.test(l)) status = 'deleted';
            const rnTo = /^rename to (.+)$/.exec(l);
            const rnFrom = /^rename from (.+)$/.exec(l);
            if (rnTo || rnFrom) status = 'renamed';
            if (rnTo) to = rnTo[1];
            j++;
          }
          const path = status === 'deleted' ? from : to;
          out.push({ path, status });
          i = j;
          continue;
        }
        i++;
      }
      setChangedFiles(out);
      setShowAllChanged(false);
    } catch { setChangedFiles([]); setShowAllChanged(false); }
  }, [patch]);

  // Auto refresh diff every 5 seconds
  useEffect(() => {
    if (!meta.repoPath) return;
    const id = setInterval(() => { refreshDiff().catch(()=>{}); }, 5000);
    return () => clearInterval(id);
  }, [meta.repoPath]);

  // Periodically refresh upstream status to enable/disable pull button
  useEffect(() => {
    if (!meta.repoPath) return;
    const id = setInterval(() => { refreshStatus().catch(()=>{}); }, 5000); // 5s
    return () => clearInterval(id);
  }, [meta.repoPath]);

  const doApplyCommitPush = async () => {
    try {
      setPushing(true);
      await axios.post("/api/git/commitPush", { repoPath: meta.repoPath, message });
      await refreshLog();
      await refreshDiff();
      toast && toast("Pushed ✅");
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Push failed";
      try { toast && toast(`Push failed: ${msg}`); } catch {}
      try { alert(`Push failed: ${msg}`); } catch {}
    } finally {
      setPushing(false);
    }
  };

  const copyHash = async (hash) => {
    try {
      await navigator.clipboard.writeText(hash);
      // Visual feedback on the button
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
      // Toast feedback (also works across the app)
      toast && toast("Commit hash copied ✅");
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
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
        toast && toast("Commit hash copied ✅");
      } catch {
        alert("Failed to copy commit hash");
      }
    }
  };

  return (
    <div className="row">
      <div className="col main-col">
        <div className="pane">
          <div className="actions" style={{marginBottom:8, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            {(() => { const disabled = pullInfo.upToDate === true; return (
              <button
                className="secondary"
                onClick={doPull}
                disabled={disabled}
                title={disabled ? 'Already up to date' : 'Fetch and pull latest'}
                style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
              >git pull</button>
            ); })()}
            <span className="muted">
              {pullInfo.at
                ? `Last pull: ${new Date(pullInfo.at).toLocaleTimeString()} • ${pullInfo.upToDate ? 'up to date' : (pullInfo.behind > 0 ? `behind ${pullInfo.behind}` : 'updated')}`
                : (pullInfo.upToDate === null ? 'Never pulled' : (pullInfo.upToDate ? 'Up to date' : 'Behind'))}
            </span>
            <select id="branch-select" value={current} onChange={e => doCheckout(e.target.value)}>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <input placeholder="commit message" value={message} onChange={e=>setMessage(e.target.value)} style={{minWidth:220}}/>
            {(() => { const canPush = Boolean((patch||"").trim()); return (
              <button onClick={doApplyCommitPush} disabled={!canPush || pushing} style={(!canPush || pushing) ? {opacity:0.6, cursor:'not-allowed'} : {}}>
                {pushing ? '⏳ Pushing…' : 'Apply & Push'}
              </button>
            );})()}
          </div>
        </div>

        <FileTree repoPath={meta.repoPath} onOpen={async (p)=>{ const r=await axios.get("/api/git/file",{params:{repoPath:meta.repoPath,path:p}}); setOpenFile(p); setOpenFileContent(r.data.text||""); }} />
        <div className="pane" style={{marginTop:16}}>
          <div className="muted" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>Last commit</span>
            <span></span>
          </div>
          <div className="repo">
            {log && log.length ? (
              <>
                <div className="muted">
                  <a href={log[0].web_url || '#'} target="_blank" rel="noreferrer" title="Open in provider">
                    {log[0].hash.slice(0, 8)}
                  </a>
                  {` · ${new Date(log[0].date).toLocaleString()}`}
                </div>
                <div style={{display:'flex', gap:8, alignItems:'center'}}>
                  <button
                    className={"secondary" + (copied ? " copied" : "")}
                    onClick={() => copyHash(log[0].hash)}
                    title="Copy full commit hash"
                    aria-live="polite"
                  >
                    {copied ? '✓ Copied' : 'copy hash'}
                  </button>
                </div>
              </>
            ) : (
              <div className="muted">No commits</div>
            )}
          </div>
        </div>
        {/* Patch preview moved here so that on desktop the terminal can occupy the left column alone */}
        <div className="pane" style={{marginTop:16}}>
          <div className="muted" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Patch preview</span>
          </div>
          {changedFiles.length > 0 && (
            <div className="muted" style={{margin:"6px 0 8px 0"}}>
              <div>
                <div style={{marginBottom:6}}>{changedFiles.length} file{changedFiles.length!==1?'s':''} changed</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {(showAllChanged ? changedFiles : changedFiles.slice(0, 15)).map((f, idx) => (
                    <span key={idx} className={"badge " + (f.status==='added'?'green':(f.status==='deleted'?'red':'gray'))} title={f.status}>{f.path}</span>
                  ))}
                  {(!showAllChanged && changedFiles.length > 15) && (
                    <button className="secondary" onClick={() => setShowAllChanged(true)}>+{changedFiles.length - 15} more</button>
                  )}
                </div>
              </div>
            </div>
          )}
          {(patch || '').trim() ? (showPretty ? <DiffPretty diff={patch} /> : <code className="diff">{patch}</code>) : null}
        </div>
      </div>

      <div className="col cli-col">
        <CodexTerminal repoPath={meta.repoPath} />
      </div>
    </div>
  )
}

export default function App() {
  const [phase, setPhase] = useState("repos"); // repos only
  const [providers, setProviders] = useState({ github: {}, gitlab: {} });
  const [activePane, setActivePane] = useState("actions"); // actions | terminal | diff | files
  const [current, setCurrent] = useState("");
  const [currentRepo, setCurrentRepo] = useState(null);
  const [meta, setMeta] = useState({ repoPath: "" });
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('themeMode') || 'auto'); // auto | dark | light
  const [loadingRepos, setLoadingRepos] = useState(false);
  const routeRef = useRef({});
  const [pendingRepoId, setPendingRepoId] = useState("");

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
              key={current}
              repos={reposForCurrent}
              onSelect={openRepo}
              currentId={current}
            />
          )
        ) : (
          <>
            <div className="pane" style={{marginBottom:12}}>
              <div className="actions" style={{display:'flex',alignItems:'center',gap:8}}>
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
            />
          </>
        )}
      </div>
      {null}
    </div>
  );
}
