# Design Studio Codex ImageGen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate popup, banner, and general-purpose images from prompts inside Design Studio using the existing authenticated Codex ImageGen runtime.

**Architecture:** Add a small server-side asynchronous job manager around `codex exec --json`, copy verified generated files into the existing upload tree, and expose authenticated create/status endpoints. Extend the existing Fabric-based studio with an AI prompt panel that polls jobs and inserts the completed image as a canvas background layer.

**Tech Stack:** Node.js, Express, Codex CLI, built-in ImageGen skill, vanilla JavaScript, Fabric.js, Node test runner

---

### Task 1: Server image job helpers

**Files:**
- Modify: `server.js`
- Test: `tests/design-studio-ai.test.js`

- [ ] Write failing tests for type/size validation, JSONL thread extraction, and safe generated-file selection.
- [ ] Run `node --test tests/design-studio-ai.test.js` and verify the new tests fail.
- [ ] Add pure validation and output parsing helpers plus an in-memory job registry.
- [ ] Run the focused test and verify it passes.

### Task 2: Authenticated generation endpoints

**Files:**
- Modify: `server.js`
- Modify: `.env.example`

- [ ] Add `POST /api/admin/design-studio/ai-images` guarded by system-admin authentication.
- [ ] Spawn Codex with fixed executable arguments, a five-minute timeout, and the installed ImageGen prompt contract.
- [ ] Copy only a newly generated PNG, WebP, or JPEG from the known Codex generated-images root into `uploads/design-studio/ai/`.
- [ ] Add `GET /api/admin/design-studio/ai-images/:jobId` returning queued, running, complete, or failed state.
- [ ] Add environment documentation for the Codex runtime paths and wrapper command.

### Task 3: Design Studio AI panel

**Files:**
- Modify: `admin-assets/js/admin-design-studio.mjs`
- Modify: `admin-assets/css/admin-design-studio.css`
- Modify: `admin-assets/js/admin-design-studio-core.mjs`
- Test: `tests/admin-design-studio-core.test.mjs`

- [ ] Add failing tests for banner, popup, square, landscape, and portrait generation presets.
- [ ] Implement the preset mapping and verify the focused core tests pass.
- [ ] Render the AI prompt panel with output type, size, prompt, generate button, progress, preview, retry, and apply controls.
- [ ] Poll the job endpoint and automatically load the completed URL through the existing `addImageFromUrl` path.
- [ ] Add responsive styling consistent with the admin UI directive.

### Task 4: Verification and production rollout

**Files:**
- Modify: deployment environment only after health verification

- [ ] Run `node --check server.js`.
- [ ] Run focused Design Studio tests and the existing UI consistency check.
- [ ] Confirm the production service is active before deployment.
- [ ] Deploy changed files, configure the least-privilege Codex execution wrapper, and restart the service.
- [ ] Generate one text-free test image, verify its public URL and Design Studio insertion, then confirm service health and logs.
