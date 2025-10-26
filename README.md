# web-codex

All‑in‑one web UI to browse your GitHub/GitLab repos, pull/branch/commit/push, and work via the Codex CLI in the container. No web login or AI instruction area — CLI‑only.

## Features

- Tabs grouped by **GitHub user/orgs** and **GitLab groups**.
- One‑click `git pull`, **branch** dropdown + checkout.
- Built‑in terminal running your configured `CODEX_CMD` (auto‑opens when a repo is opened).
- **Commit history** (last 10) with a “copy hash” action.

## Quick Start (Docker)

```bash
# Build (use the Dockerfile in src/ with src/ as context)
docker build -f src/Dockerfile -t web-codex:0.1.0 src

# Run (map port and data volume). Provide tokens via env or secrets.
docker run --rm -p 8080:8080 \
  -e GH_TOKEN=ghp_... -e GH_USER=your-username -e GH_ORGS=org1,org2 \
  -e GL_TOKEN=glpat-... -e GL_BASE_URL=https://gitlab.com -e GL_GROUPS=groupA,groupB \
  -e CODEX_CMD=codex -e HOME=/home/app \
  -v $(pwd)/data:/data \
  web-codex:0.1.0
```

Open http://localhost:8080

## Kubernetes (manifests in `src/k8s/`)

```bash
kubectl apply -f src/k8s/pvc.yaml
kubectl apply -f src/k8s/secret.example.yaml   # edit values first
kubectl apply -f src/k8s/deployment.yaml
kubectl apply -f src/k8s/ingress.yaml
```

> **Security note**: For HTTPS Git pushes, tokens are injected into the remote URL in‑memory for that push (`oauth2:<token>@…`). Avoid enabling verbose logs in production.

## OpenAI Codex note

The **2021 Codex API models** (`code-*`) were deprecated in 2023, but **OpenAI Codex** (the agentic coding tool) is alive and well in 2025. This app defaults to **`gpt-5-codex`** and first uses the **Responses API**, then falls back to **Chat Completions** using the same model ID if needed. Override the model with `OPENAI_MODEL` if your account uses a different deployment.

## How AI Patch works

1. Backend builds a short context (repo tree + optional small files you can hint later).
2. Sends your instruction to OpenAI with a strict system prompt to **return only a unified diff** in a fenced `diff` block.
3. Validates patch with `git apply --check`.
4. You review the patch in the UI.
5. Apply -> commit -> push.

If the model emits an invalid patch, you can retry with a clearer instruction.

## Environment Variables

- `OPENAI_API_KEY` — OpenAI API key. Required to enable the AI Patch button. If unset, you can still use the CLI flows.
- `OPENAI_MODEL` — Model ID used for AI Patch. Default: `gpt-5-codex`. Backend tries Responses first, then Chat Completions with the same model ID.
- `PORT` — HTTP listen port. Default: `8080`.
- `DATA_DIR` — Root for repository storage. Default: `/data/repos`. Mount `/data` to persist.

- Debugging:
  - `DEBUG` — set to `1`, `true`, or `debug` to enable verbose backend logs (Axios request URLs, per‑provider errors, clone details). Sensitive tokens are redacted in logs.

- GitHub:
  - `GH_TOKEN` — Personal access token. Required to list repos and push.
  - `GH_USER` — Target GitHub username. If omitted, uses the token’s identity.
    - Only repositories OWNED by `GH_USER` are listed under that tab.
    - If `GH_USER` ≠ token identity, only public repos can be listed (GitHub API limitation).
  - `GH_ORGS` — Comma‑separated orgs to show (e.g., `org1,org2`). Optional; lists repositories in each org.

- GitLab:
  - `GL_TOKEN` — Personal access token. Required to list group projects and push.
  - `GL_BASE_URL` — Base URL of your GitLab instance. Default: `https://gitlab.com`.
  - `GL_GROUPS` — Comma‑separated group IDs or full paths (e.g., `12345`, `mygroup/subgroup`).

- Codex CLI integration:
  - `CODEX_CMD` — Command executed in the in‑browser terminal. Default: `codex`.
  - `CODEX_PATCH_CMD` — Shell template to generate edits in a temporary worktree. Optional; when set, enables “Patch (CLI)”.
    - Placeholders: `{{instruction_file}}` (path to a temp file with the user instruction), `{{repo_root}}` (path to the worktree).
    - Example: `CODEX_PATCH_CMD='codex < {{instruction_file}}'`

## Dev

```bash
cd src
npm i
npm run dev
# FE: http://localhost:5173  | BE: http://localhost:8080
```

The backend dev server loads environment variables from `src/backend/.env` (via `node --env-file=.env`). Create that file to customize your local run, for example:

```ini
# src/backend/.env
PORT=8080
DATA_DIR=/data/repos
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-codex
GH_TOKEN=ghp_...
GH_USER=your-username
GH_ORGS=org1,org2
GL_TOKEN=glpat-...
GL_BASE_URL=https://gitlab.com
GL_GROUPS=mygroup
# Optional for CLI patch
# CODEX_PATCH_CMD=codex < {{instruction_file}}
# Debugging
DEBUG=1
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

## First-run flow

- If `OPENAI_API_KEY` is set, the app skips the CLI intro and goes straight to the Repos screen. You can use **Patch (API)** without any CLI login.
- If you prefer the CLI-only workflow, leave `OPENAI_API_KEY` unset and use the intro terminal to run `codex` and log in manually, then click **Continue to Repos**.

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
