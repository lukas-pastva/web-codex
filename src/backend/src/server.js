import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import simpleGit from "simple-git";
import OpenAI from "openai";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// Config endpoint
app.get("/api/config", (req, res) => {
  res.json({ openai: Boolean(OPENAI_API_KEY), cliPatch: Boolean(process.env.CODEX_PATCH_CMD) });
});

// ---- Configuration ----
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || "/data/repos";
const TMP_ROOT = path.join(DATA_DIR, "_tmp");
if (!fs.existsSync(TMP_ROOT)) fs.mkdirSync(TMP_ROOT, { recursive: true });
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-codex";
const GH_TOKEN = process.env.GH_TOKEN || "";
const GH_USER = process.env.GH_USER || "";
const GH_ORGS = (process.env.GH_ORGS || "").split(",").map(s => s.trim()).filter(Boolean);
const GL_TOKEN = process.env.GL_TOKEN || "";
const GL_BASE_URL = (process.env.GL_BASE_URL || "https://gitlab.com").replace(/\/$/, "");
const GL_GROUPS = (process.env.GL_GROUPS || "").split(",").map(s => s.trim()).filter(Boolean);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- OpenAI Client ----
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ---- Utilities ----
function safeJoin(base, p) {
  const full = path.resolve(base, p);
  if (!full.startsWith(path.resolve(base))) throw new Error("Path traversal not allowed");
  return full;
}

function repoStoragePath(provider, owner, name) {
  const p = path.join(DATA_DIR, provider, owner, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

async function ensureClone(provider, owner, name, cloneUrl) {
  const repoPath = repoStoragePath(provider, owner, name);
  const git = simpleGit(repoPath);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    // Initial clone
    const parent = path.dirname(repoPath);
    fs.mkdirSync(parent, { recursive: true });
    const remoteWithToken = injectTokenIntoUrl(cloneUrl);
    await simpleGit(parent).clone(remoteWithToken, path.basename(repoPath));
  }
  return repoPath;
}

function injectTokenIntoUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("github.com") && GH_TOKEN) {
      u.username = "oauth2";
      u.password = GH_TOKEN;
    } else if (u.hostname.includes("gitlab") && GL_TOKEN) {
      // GitLab: use oauth2:<token>@
      u.username = "oauth2";
      u.password = GL_TOKEN;
    }
    return u.toString();
  } catch (e) {
    return url;
  }
}

function redact(str) {
  return String(str || "").replaceAll(GH_TOKEN, "***").replaceAll(GL_TOKEN, "***");
}

// ---- Providers: fetch repos ----
app.get("/api/providers", async (req, res) => {
  try {
    const out = { github: {}, gitlab: {} };
    // GitHub repos: user + orgs
    if (GH_TOKEN) {
      const ghHeaders = { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" };
      const ghUser = GH_USER || (await axios.get("https://api.github.com/user", { headers: ghHeaders })).data.login;
      const userRepos = (await axios.get("https://api.github.com/user/repos?per_page=100", { headers: ghHeaders })).data;
      out.github[ghUser] = userRepos.map(r => ({ name: r.name, full_name: r.full_name, default_branch: r.default_branch, clone_url: r.clone_url, ssh_url: r.ssh_url, html_url: r.html_url, private: r.private }));
      for (const org of GH_ORGS) {
        const orgRepos = (await axios.get(`https://api.github.com/orgs/${org}/repos?per_page=100`, { headers: ghHeaders })).data;
        out.github[org] = orgRepos.map(r => ({ name: r.name, full_name: r.full_name, default_branch: r.default_branch, clone_url: r.clone_url, ssh_url: r.ssh_url, html_url: r.html_url, private: r.private }));
      }
    }
    // GitLab repos: groups
    if (GL_TOKEN && GL_GROUPS.length) {
      const glHeaders = { "Private-Token": GL_TOKEN };
      for (const grp of GL_GROUPS) {
        const encoded = encodeURIComponent(grp);
        const url = `${GL_BASE_URL}/api/v4/groups/${encoded}/projects?per_page=100`;
        const projects = (await axios.get(url, { headers: glHeaders })).data;
        out.gitlab[grp] = projects.map(p => ({ id: p.id, name: p.path, full_name: p.path_with_namespace, default_branch: p.default_branch, clone_url: p.http_url_to_repo, ssh_url: p.ssh_url_to_repo, web_url: p.web_url, private: !p.public }));
      }
    }
    res.json(out);
  } catch (err) {
    console.error("providers error:", err.response?.status, redact(err.response?.data) || err.message);
    res.status(500).json({ error: "Failed to fetch providers", details: err.message });
  }
});

// ---- Git operations ----
app.post("/api/git/clone", async (req, res) => {
  try {
    const { provider, owner, name, clone_url } = req.body;
    const repoPath = await ensureClone(provider, owner, name, clone_url);
    res.json({ ok: true, repoPath });
  } catch (err) {
    console.error("clone error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/pull", async (req, res) => {
  try {
    const { repoPath } = req.body;
    const git = simpleGit(repoPath);
    await git.fetch();
    const result = await git.pull();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/git/branches", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const git = simpleGit(repoPath);
    const branches = await git.branchLocal();
    res.json({ ok: true, current: branches.current, all: branches.all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/checkout", async (req, res) => {
  try {
    const { repoPath, branch } = req.body;
    const git = simpleGit(repoPath);
    await git.checkout(branch);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/commitPush", async (req, res) => {
  try {
    const { repoPath, message } = req.body;
    const git = simpleGit(repoPath);
    await git.add("--all");
    const msg = message || `codex-${new Date().toISOString()}`;
    const commit = await git.commit(msg);
    // Push with token in remote URL if needed
    const remotes = await git.getRemotes(true);
    let origin = remotes.find(r => r.name === "origin");
    if (!origin) throw new Error("No origin remote configured");
    const url = injectTokenIntoUrl(origin.refs.push || origin.refs.fetch);
    await git.push(url, undefined, ["--follow-tags"]);
    res.json({ ok: true, commit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---- Git status (working tree) ----
app.get("/api/git/status", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const git = simpleGit(repoPath);
    const st = await git.status();
    res.json({ ok: true, status: st });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Git diff (working tree) ----
app.get("/api/git/diff", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const git = simpleGit(repoPath);
    const diff = await git.raw(["diff"]);
    res.json({ ok: true, diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- AI Patch (Unified Diff) ----
// ---- CLI Patch (Unified Diff via local Codex CLI) ----
app.post("/api/cli/patch", async (req, res) => {
  try {
    const { repoPath, instruction } = req.body;
    const PATCH_CMD_TPL = process.env.CODEX_PATCH_CMD || "";
    if (!PATCH_CMD_TPL) {
      return res.status(400).json({ error: "CLI patch disabled. Set CODEX_PATCH_CMD (e.g., \"codex < {{instruction_file}}\")." });
    }
    if (!repoPath || !fs.existsSync(repoPath)) {
      return res.status(400).json({ error: "Invalid repoPath" });
    }
    const git = simpleGit(repoPath);
    const branch = (await git.branchLocal()).current || "HEAD";
    const wid = uuidv4().slice(0,8);
    const tmpDir = path.join(TMP_ROOT, `worktree-${wid}`);
    // add worktree at HEAD
    await git.raw(["worktree", "add", tmpDir, "HEAD"]);
    try {
      const instrFile = path.join(tmpDir, "_codex_instruction.txt");
      fs.writeFileSync(instrFile, instruction || "", "utf-8");
      // Build command from template
      const cmd = PATCH_CMD_TPL
        .replaceAll("{{instruction_file}}", instrFile)
        .replaceAll("{{repo_root}}", tmpDir);
      // Execute in tmpDir
      const exec = spawnSync("bash", ["-lc", cmd], { cwd: tmpDir, env: process.env, encoding: "utf-8", maxBuffer: 10*1024*1024 });
      const stdout = exec.stdout || "";
      const stderr = exec.stderr || "";
      // Warn if the CLI exited with a non-zero status (ignore 0 and null/signal cases)
      if (exec.status !== 0 && exec.status !== null) {
        console.warn("CLI patch non-zero exit:", exec.status, stderr.substring(0, 500));
      }
      // Capture diff
      const tmpGit = simpleGit(tmpDir);
      const diff = await tmpGit.raw(["diff"]);
      res.json({ ok: true, patch: diff, cli: { status: exec.status, stdout: stdout.slice(0,20000), stderr: stderr.slice(0,20000) } });
    } finally {
      try { await git.raw(["worktree", "remove", "--force", tmpDir]); } catch (e) { console.warn("worktree cleanup failed:", e.message); }
    }
  } catch (err) {
    console.error("cli/patch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Git status (working tree) ----
app.get("/api/git/status", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const git = simpleGit(repoPath);
    const st = await git.status();
    res.json({ ok: true, status: st });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Git diff (working tree) ----
app.get("/api/git/diff", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const git = simpleGit(repoPath);
    const diff = await git.raw(["diff"]);
    res.json({ ok: true, diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- AI Patch (Unified Diff) ----
app.post("/api/ai/patch", async (req, res) => {
  try {
    const { repoPath, instruction, fileHints = [] } = req.body;
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

    // Collect small context: repo tree (limited) + selected files content (if provided)
    function listFiles(dir, acc = [], root = dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === ".git") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) listFiles(full, acc, root);
        else acc.push(path.relative(root, full));
      }
      return acc;
    }
    const tree = listFiles(repoPath).filter(f => !f.includes("node_modules")).slice(0, 500);
    const pick = (p) => {
      const abs = safeJoin(repoPath, p);
      if (fs.existsSync(abs) && fs.statSync(abs).size <= 120000) {
        return "\n--- FILE: " + p + " ---\n" + fs.readFileSync(abs, "utf-8");
      } else return "\n--- FILE: " + p + " ---\n<omitted due to size>";
    };

    const filesContext = (fileHints || []).slice(0, 8).map(pick).join("\n");

    const system = `You are CodePatchGPT. You edit a Git repository by producing a VALID unified diff (patch) in one block.
Rules:
- ONLY output the patch inside a single fenced code block tagged 'diff'.
- Use paths relative to repo root.
- Keep changes minimal and idempotent.
- If creating a new file, include proper diff headers (e.g., new file mode 100644).
- Do not include explanations or extra text outside the diff block.`;

    const prompt = `Repo has ~${tree.length} files. User instruction:
"""
${instruction}
"""

Optional file samples for context:
${filesContext || "(none)"}

Now return a unified diff that applies cleanly. If no changes are needed, return an empty patch block (with no hunks).`;

    // Use Responses API (preferred) and fall back to Chat Completions if necessary
    let patchText = "";
    try {
      const resp = await openai.responses.create({
        model: OPENAI_MODEL,
        input: prompt,
        instructions: system
      });
      patchText = (resp.output_text || "").trim();
    } catch (e) {
      const resp = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      });
      patchText = resp.choices?.[0]?.message?.content?.trim() || "";
    }

    // Extract code block with diff
    const m = patchText.match(/```diff([\s\S]*?)```/);
    const rawPatch = (m ? m[1] : patchText).trim();
    if (!rawPatch) throw new Error("Model did not return a patch");

    // Validate patch (dry run)
    const git = simpleGit(repoPath);
    try {
      await git.raw(["apply", "--check", "-p0"], rawPatch);
    } catch (e) {
      // Try with -p1 (paths often prefixed with a/ and b/)
      await git.raw(["apply", "--check", "-p1"], rawPatch);
    }

    res.json({ ok: true, patch: rawPatch });
  } catch (err) {
    console.error("ai/patch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/apply-commit-push", async (req, res) => {
  try {
    const { repoPath, patch, message } = req.body;
    const git = simpleGit(repoPath);
    try {
      await git.raw(["apply", "-p0"], patch);
    } catch (e) {
      await git.raw(["apply", "-p1"], patch);
    }
    await git.add("--all");
    const msg = message || `codex-${new Date().toISOString()}`;
    const commit = await git.commit(msg);
    const remotes = await git.getRemotes(true);
    let origin = remotes.find(r => r.name === "origin");
    if (!origin) throw new Error("No origin remote configured");
    const url = injectTokenIntoUrl(origin.refs.push || origin.refs.fetch);
    await git.push(url);
    res.json({ ok: true, commit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Commit log (history) ----
app.get("/api/git/log", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const git = simpleGit(repoPath);
    const log = await git.log({ n: 30 });
    // attach remote web URLs if possible
    let webBase = "";
    try {
      const remotes = await git.getRemotes(true);
      const url = remotes.find(r => r.name === "origin")?.refs.fetch || "";
      if (url.includes("github.com")) {
        const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?/);
        if (m) webBase = `https://github.com/${m[1]}/${m[2]}/commit/`;
      } else if (url.includes("gitlab")) {
        const m = url.match(/gitlab[^/]+[/:]([^/]+)\/(.+?)(\.git)?$/);
        if (m) webBase = `${GL_BASE_URL}/${m[1]}/${m[2]}/-/commit/`;
      }
    } catch {}
    const items = log.all.map(c => ({ hash: c.hash, message: c.message, date: c.date, author_name: c.author_name, web_url: webBase ? webBase + c.hash : "" }));
    res.json({ ok: true, commits: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Serve frontend build ----
const frontendDir = path.join(__dirname, "../frontend/dist");
if (fs.existsSync(frontendDir)) {
  app.use("/", express.static(frontendDir));
  app.get("*", (req, res) => res.sendFile(path.join(frontendDir, "index.html")));
} else {
  app.get("/", (req, res) => res.send("web-codex backend is running. Build the frontend to serve UI."));
}

const server = http.createServer(app);

// ---- WebSocket: /ws/terminal ----
const wss = new WebSocketServer({ server, path: "/ws/terminal" });
wss.on("connection", (ws, req) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const repoPath = url.searchParams.get("repoPath") || "";
    const cmd = process.env.CODEX_CMD || "codex"; // configurable
    // Validate repoPath and set cwd
    let cwd = DATA_DIR;
    if (repoPath) {
      try { cwd = safeJoin(DATA_DIR, path.relative(DATA_DIR, repoPath)); } catch { /* fallback */ }
    }
    const shell = process.env.SHELL || "/bin/sh";
    const p = pty.spawn(shell, ["-lc", cmd], {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, OPENAI_API_KEY }
    });
    p.onData(data => ws.readyState === 1 && ws.send(data));
    p.onExit(() => { try { ws.close(); } catch {} });
    ws.on("message", msg => { try { p.write(msg.toString()); } catch {} });
    ws.on("close", () => { try { p.kill(); } catch {} });
  } catch (e) { try { ws.close(); } catch {} }
});

server.listen(PORT, () => {
  console.log(`web-codex listening on :${PORT}`);
});


// ---- Health endpoints ----
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/readyz", (req, res) => {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const fp = path.join(DATA_DIR, ".readyz.touch");
    fs.writeFileSync(fp, "ok");
    fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e?.message || e) });
  }
});



// ---- Git tree (shallow) ----
app.get("/api/git/tree", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const depth = Number(req.query.depth || 3);
    const maxFiles = Number(req.query.max || 1000);
    function ls(dir, d=0) {
      if (d > depth) return [];
      const out = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(repoPath, full);
        if (e.isDirectory()) {
          out.push({ type:"dir", name:e.name, path:rel });
          out.push(...ls(full, d+1));
        } else {
          out.push({ type:"file", name:e.name, path:rel, size: fs.statSync(full).size });
        }
        if (out.length >= maxFiles) break;
      }
      return out;
    }
    const files = ls(repoPath, 0);
    res.json({ ok:true, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---- Git file (content) ----
app.get("/api/git/file", async (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    const p = req.query.path;
    const abs = safeJoin(repoPath, p);
    const stat = fs.statSync(abs);
    if (stat.size > 500000) return res.status(413).json({ error: "File too large" });
    const text = fs.readFileSync(abs, "utf-8");
    res.json({ ok:true, path:p, size:stat.size, text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---- CI last run status (best-effort) ----
app.get("/api/ci/last", async (req, res) => {
  try {
    const { provider, owner, name, gitlabId } = req.query;
    if (provider === "github" && GH_TOKEN) {
      const headers = { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" };
      const runs = (await axios.get(`https://api.github.com/repos/${owner}/${name}/actions/runs?per_page=1`, { headers })).data;
      const run = runs.workflow_runs?.[0];
      return res.json({ ok:true, provider, status: run?.conclusion || run?.status || "unknown", url: run?.html_url || "" });
    }
    if (provider === "gitlab" && GL_TOKEN && gitlabId) {
      const headers = { "Private-Token": GL_TOKEN };
      const url = `${GL_BASE_URL}/api/v4/projects/${encodeURIComponent(gitlabId)}/pipelines?per_page=1`;
      const p = (await axios.get(url, { headers })).data?.[0];
      return res.json({ ok:true, provider, status: p?.status || "unknown", url: p?.web_url || "" });
    }
    res.json({ ok:true, status: "unknown" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
