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

function RepoList({ repos, onSelect, favs, toggleFav, query, setQuery }) {
  const sorted = [...repos].sort((a,b)=>{
    const af = favs.includes(a.full_name||a.path_with_namespace);
    const bf = favs.includes(b.full_name||b.path_with_namespace);
    return af===bf ? 0 : (af?-1:1);
  });
  const filtered = sorted.filter(r => (r.full_name||r.path_with_namespace||r.name).toLowerCase().includes((query||'').toLowerCase()));
  return (
    <div className="pane">
      <div className="actions" style={{marginBottom:8}}>
        <input id="repo-search" placeholder="Search repos…" value={query} onChange={e=>setQuery(e.target.value)} />
      </div>
      {filtered.map((r, i) => (
        <div key={i} className="repo">
          <div>
            <div><strong>{r.name}</strong></div>
            <div className="muted">{r.full_name || r.path_with_namespace}</div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button className="secondary" onClick={()=>toggleFav(r.full_name||r.path_with_namespace)}>{favs.includes(r.full_name||r.path_with_namespace)?'⭐':'☆'}</button>
            <button onClick={() => onSelect(r)}>Open</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function RepoActions({ repo, meta, setMeta, openaiEnabled, cliPatchEnabled, onToggleHelp }) {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [current, setCurrent] = useState("");
  const [log, setLog] = useState([]);
  const [instruction, setInstruction] = useState("");
  const [patch, setPatch] = useState("");
  const [message, setMessage] = useState("codex-" + new Date().toISOString());
  const [showPretty, setShowPretty] = useState(false);
  const [openFile, setOpenFile] = useState(null);
  const [openFileContent, setOpenFileContent] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(5);
  const [showTerm, setShowTerm] = useState(false);

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
      if (e.key === '/') { e.preventDefault(); const el = document.getElementById('repo-search'); el && el.focus(); }
      if (e.key === 'p') { e.preventDefault(); doPull(); }
      if (e.key === 'b') { e.preventDefault(); const el = document.getElementById('branch-select'); el && el.focus(); }
      if (e.key === 't') { e.preventDefault(); setShowTerm(s => !s); }
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

  const doAI = async () => {
    setPatch("");
    try {
      if (cliPatchEnabled) {
        const r = await axios.post("/api/cli/patch", { repoPath: meta.repoPath, instruction });
        setPatch(r.data.patch || "");
        return;
      }
    } catch (e) {
      console.warn("CLI patch failed, falling back to API if enabled", e?.response?.data || e.message);
    }
    if (openaiEnabled) {
      const r = await axios.post("/api/ai/patch", { repoPath: meta.repoPath, instruction });
      setPatch(r.data.patch);
    } else {
      alert("No patch method available. Configure CODEX_PATCH_CMD or OPENAI_API_KEY.");
    }
  };

  const doApplyCommitPush = async () => {
    if (!patch) return;
    await axios.post("/api/git/apply-commit-push", { repoPath: meta.repoPath, patch, message });
    await refreshLog();
    toast("Pushed ✅");
  };

  return (
    <div className="row">
      <div className="col">
        <div className="pane">
          <div className="actions" style={{marginBottom:8}}>
            <button className="secondary" onClick={doPull}>git pull</button>
            <select id="branch-select" value={current} onChange={e => doCheckout(e.target.value)}>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div style={{marginTop:8}}>
            <div className="muted">AI instruction</div>
            <textarea placeholder="Describe the change you want (e.g., 'convert fetch to axios in src/api.js and add retry')"
                      value={instruction} onChange={e=>setInstruction(e.target.value)} />
            <div className="actions" style={{marginTop:8}}>
              <button className="secondary" onClick={() => setShowTerm(true)}>🖥️ Codex CLI</button>
              {cliPatchEnabled ? <button onClick={doAI}>💡 Patch (CLI)</button> : (openaiEnabled ? <button onClick={doAI}>💡 Patch (API)</button> : null)}
              <input placeholder="commit message" value={message} onChange={e=>setMessage(e.target.value)}/>
              <button onClick={doApplyCommitPush}>Apply & Push</button>
            </div>
          </div>
        </div>

        <FileTree repoPath={meta.repoPath} onOpen={async (p)=>{ const r=await axios.get("/api/git/file",{params:{repoPath:meta.repoPath,path:p}}); setOpenFile(p); setOpenFileContent(r.data.text||""); }} />
        <div className="pane" style={{marginTop:16}}>
          <div className="muted">Last 30 commits</div>
          <div className="commit-list">
            {log.map(c => (
              <div key={c.hash} className="repo">
                <div>
                  <div><strong>{c.message}</strong></div>
                  <div className="muted">{c.hash.slice(0,8)} · {new Date(c.date).toLocaleString()}</div>
                </div>
                <div>{c.web_url ? <a href={c.web_url} target="_blank">open</a> : <span className="tag">no link</span>}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="col">
        {showTerm && <CodexTerminal repoPath={meta.repoPath} onClose={() => setShowTerm(false)} />}
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
  const [phase, setPhase] = useState("intro"); // intro | repos
  const [openaiEnabled, setOpenaiEnabled] = useState(false);
  const [cliPatchEnabled, setCliPatchEnabled] = useState(false);
  const [providers, setProviders] = useState({ github: {}, gitlab: {} });
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState(() => JSON.parse(localStorage.getItem("favs")||"[]"));
  const [showHelp, setShowHelp] = useState(false);
  const [activePane, setActivePane] = useState("actions"); // actions | terminal | diff | files
  const [current, setCurrent] = useState("");
  const [currentRepo, setCurrentRepo] = useState(null);
  const [meta, setMeta] = useState({ repoPath: "" });
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('themeMode') || 'auto'); // auto | dark | light
  const routeRef = useRef({});
  const [pendingRepoId, setPendingRepoId] = useState("");

  // --- Simple hash router ---
  function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (!h) return { page: 'intro' };
    const [page, qs] = h.split('?');
    const params = {};
    if (qs) {
      for (const part of qs.split('&')) {
        const [k, v=''] = part.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v);
      }
    }
    return { page: page || 'intro', params };
  }
  function buildHash(next) {
    const { page = 'intro', params = {} } = next || {};
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
    setPhase(page === 'repos' ? 'repos' : 'intro');
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

  const fetchConfig = async () => {
    try { const r = await axios.get("/api/config"); setOpenaiEnabled(Boolean(r.data.openai)); setCliPatchEnabled(Boolean(r.data.cliPatch)); } catch {}
  };

  const load = async () => {
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
  useEffect(() => { fetchConfig(); }, []);
  // If API key is present, skip intro and go straight to repos
  useEffect(() => {
    if (openaiEnabled && phase === 'intro') {
      setPhase('repos');
    }
  }, [openaiEnabled, phase]);
  useEffect(() => { if (phase === "repos") load(); }, [phase]);

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
        <div><strong>web-codex</strong></div>
        <div className="tag">all-in-one</div>
        <div className="tag">OpenAI-powered</div>
        <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
          <button
            className="secondary icon"
            onClick={() => setShowHelp(true)}
            title={"Shortcuts: / search, p pull, b branch, t terminal, d diff, c commit. Disabled while typing. Press ? for full help."}
          >⌨️</button>
          <button className="secondary icon" onClick={cycleTheme} title={`Theme: ${themeMode}`}>{themeIcon}</button>
        </div>
      </header>
      <div className="container">
        {phase === "intro" ? (
          <div>
            <div className="pane" style={{marginBottom:12}}>
              <div className="muted">First run</div>
              <p>Use the terminal below to run <code>codex</code> and sign in manually. When you're done, continue to repos.</p>
              <p className="muted">No OPENAI token is required here; this is a native CLI session.</p>
            </div>
            <CodexTerminal repoPath={""} onClose={() => {}} />
            <div style={{marginTop:12}}>
              <button onClick={() => setPhase("repos")}>Continue to Repos</button>
            </div>
          </div>
        ) : (
          <>
            <GroupTabs providers={providers} current={current} setCurrent={setCurrent} />
            {!currentRepo ? (
              <RepoList
                repos={reposForCurrent}
                onSelect={openRepo}
                favs={favs}
                toggleFav={(full)=>{const next=favs.includes(full)?favs.filter(f=>f!==full):[...favs,full]; setFavs(next); localStorage.setItem('favs', JSON.stringify(next));}}
                query={query}
                setQuery={setQuery}
              />
            ) : (
              <RepoActions
                repo={currentRepo}
                meta={meta}
                setMeta={setMeta}
                openaiEnabled={openaiEnabled}
                cliPatchEnabled={cliPatchEnabled}
                onToggleHelp={() => setShowHelp(h => !h)}
              />
            )}
          </>
        )}
      </div>
      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
