# Camunda Modeler

## Cursor Cloud specific instructions

### Overview

Camunda Modeler is an Electron desktop app for modeling BPMN, DMN, and Forms. It uses npm workspaces with two packages: `app` (Electron main process, CommonJS) and `client` (React renderer, ES modules). See `README.md` and `.github/CONTRIBUTING.md` for full setup and contribution guidelines.

### Node.js version

CI uses **Node.js 24**. Use `nvm use 24` (or install via `nvm install 24`) before running any commands. The default nvm alias should be set to 24.

### Key commands

| Action | Command |
|---|---|
| Install dependencies | `npm install` |
| Lint | `npm run lint` |
| App (main process) tests | `npm run app:test` |
| Client (renderer) tests | `npm run client:test` |
| All tests sequentially | `npm test` |
| Dev mode (Electron + webpack watch) | `npm run dev` |
| Full CI check (lint + test + build) | `npm run all` |

### Running in headless/container environments

- The dbus errors (`Failed to connect to the bus`) are expected and harmless in container environments without a full desktop session.
- Electron requires a display server. Ensure `DISPLAY` is set (e.g., `DISPLAY=:1`) with an X11 server running.
- The `npm run dev` command first builds the preload script, then runs the Electron app and client webpack watcher in parallel. The Electron window may initially show `ERR_FILE_NOT_FOUND` until webpack finishes the first client build (~12s). This is normal startup behavior.
- Client tests use Karma with Puppeteer's bundled Chromium (ChromeHeadless). No external Chrome installation is needed for tests, but `google-chrome` is used if available.

### No external services required

All core modeling features (BPMN, DMN, Forms, RPA) work fully offline. External services (Zeebe/Camunda 8 engine, Sentry, Mixpanel, Marketplace API) are optional and gracefully disabled when not configured.
