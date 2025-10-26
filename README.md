# web-codex

All‑in‑one UI to browse your GitHub/GitLab repos, pull/branch/commit/push, and ask AI to generate a **unified diff patch** for your changes, preview it, then apply & push.

## Features

- Tabs grouped by **GitHub user/orgs** and **GitLab groups**.
- One‑click `git pull`, **branch** dropdown + checkout.
- **AI Patch ("Codex")**: describe the change; backend asks OpenAI to produce a **diff**. Preview, then **Apply & Push**.
- **Commit history** (last 30), with links to remote commits so your CI/CD can pick them up.

## Quick Start (Docker)

```bash
docker build -t web-codex:0.1.0 .
docker run --rm -p 8080:8080   -e OPENAI_API_KEY=sk-...   -e GH_TOKEN=ghp_... -e GH_USER=your-username -e GH_ORGS=org1,org2   -e GL_TOKEN=glpat-... -e GL_BASE_URL=https://gitlab.com -e GL_GROUPS=12345   -v $(pwd)/data:/data web-codex:0.1.0
```

Open http://localhost:8080

## Kubernetes (manifests in `k8s/`)

```bash
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/secret.example.yaml   # edit values first
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

> **Security note**: For HTTPS Git pushes, tokens are injected into the remote URL in‑memory for that push (`oauth2:<token>@…`). Avoid enabling verbose logs in production.

## OpenAI Codex note

The **2021 Codex API models** (`code-*`) were deprecated in 2023, but **OpenAI Codex** (the agentic coding tool) is alive and well in 2025. This app defaults to **`gpt-5-codex`** via the **Responses API** (with a safe fallback to Chat Completions using `gpt-4o-mini`). You can override the model with `OPENAI_MODEL`.

## How AI Patch works

1. Backend builds a short context (repo tree + optional small files you can hint later).
2. Sends your instruction to OpenAI with a strict system prompt to **return only a unified diff** in a fenced `diff` block.
3. Validates patch with `git apply --check`.
4. You review the patch in the UI.
5. Apply -> commit -> push.

If the model emits an invalid patch, you can retry with a clearer instruction.

## Environment

- `OPENAI_API_KEY` – OpenAI key.
- **GitHub**: `GH_TOKEN`, `GH_USER`, optional `GH_ORGS` (comma‑separated).
- **GitLab**: `GL_TOKEN`, `GL_BASE_URL` (default `https://gitlab.com`), `GL_GROUPS` (IDs or paths).
- `DATA_DIR` – repo storage (default `/data/repos`).

## Dev

```bash
npm i
npm run dev
# FE: http://localhost:5173  | BE: http://localhost:8080
```

## Caveats / Next steps

- Provide **file selection** and **larger context** per patch.
- Add **branch create** PR/MR helpers.
- Stream patches; show **git status**; per‑repo settings.
- Token storage: env vars – integrate a vault for prod.

## License

MIT

## Codex CLI (interactive)

Click **🖥️ Codex CLI** to open an in‑browser terminal wired to a PTY in the container. 
It runs the command from `CODEX_CMD` (default `codex`) in the current repo directory.

**Env:**  
- `CODEX_CMD` — command to execute for the Codex CLI (default `codex`).

**Container prerequisites:** the image installs build deps for `node-pty` and attempts `npm i -g @openai/codex`.
If your CLI binary has a different name, set `CODEX_CMD` accordingly.

## First-run flow (no OpenAI token needed)

When the app opens, you'll see an **Intro** screen with a terminal. Type `codex` and log in manually.
After you finish the login, click **Continue to Repos** to load your GitHub/GitLab repos.

- No `OPENAI_API_KEY` is required for the CLI flow.
- The **AI Patch** button is hidden unless `OPENAI_API_KEY` is set (optional).

## Patch via Codex CLI (no API token)

Set an environment variable that defines how to run your Codex CLI in batch to produce edits:

- `CODEX_PATCH_CMD` — a shell template that runs in a temporary git worktree. You can reference:
  - `{{instruction_file}}` — a file containing the user instruction
  - `{{repo_root}}` — the worktree path where the CLI should operate

Example (simple stdin-driven CLI):

```bash
# edits files based on instruction, then we compute `git diff`
CODEX_PATCH_CMD='codex < {{instruction_file}}'
```

When you click **Patch (CLI)**, we:
1. Create a temporary worktree at `HEAD`.
2. Run your command template in that worktree.
3. Capture `git diff` as a unified patch and show it.
4. If you accept, we apply+commit+push in the main worktree.

## Chat-first workflow (no CODEX_PATCH_CMD, no OPENAI token)

1. Open the app → Intro terminal → run `codex` and log in.
2. Click **Continue to Repos**, open a repo, then click **🖥️ Codex CLI** (already open by default).
3. Chat with Codex; it edits files directly in the repo working tree.
4. Click **🔄 Refresh Diff** to preview `git diff` of your working copy.
5. If happy: enter a commit message and hit **Apply & Push** (stages all, commits, pushes).

> Tip: Leave `CODEX_PATCH_CMD` **unset** and do not provide `OPENAI_API_KEY` if you want CLI-only.

## Health checks (Kubernetes)
- **/healthz** — liveness probe
- **/readyz** — readiness probe (verifies /data is writable)
The deployment already includes HTTP probes for both endpoints.

## Auto-refresh diff
In the repo view, toggle **Auto refresh** to periodically update the working‑tree diff and status.
You can set the refresh interval (default 5s; minimum 2s).
