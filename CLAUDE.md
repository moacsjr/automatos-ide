# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

**Cognitive RPA Monorepo** — A No-Code automation platform built as an Nx monorepo with TypeScript, React 19, Node.js 22, and Playwright, deployed on AWS (Fargate, SQS, DynamoDB, S3).

The original spec lives in `spec/PRD.md`.

## Architecture

```
apps/web-platform        → SPA React (Vite) - Host UI + RPA Cockpit dashboard
apps/api-gateway         → AWS Lambda functions (session orchestration, CRUD)
apps/rpa-worker          → Docker Node.js image (Playwright execution environment)
libs/automation-core     → Shared types, DSL interpreter, secure step runner
libs/pluggable-core      → Stub for @pluggable-js/core (plugin registry)
libs/pluggable-react     → Stub for @pluggable-js/react (UI component host)
```

### Key Dependencies

- **`@pluggable-js/core`** and **`@pluggable-js/react`** — local stubs in `libs/`. Replace with real npm packages when available.
- **`@rpa/automation-core`** — path-mapped in `tsconfig.base.json` to `libs/automation-core/src/index.ts`.

### DSL & Interpreter

`libs/automation-core` contains:
- `domain/types.ts` — `AutomationStep`, `WorkflowJob`, `ExecutionContext` types
- `interpreter/safe-runner.ts` — `SafeAutomationInterpreter` resolves `{{variable.key}}` templates from context, supports conditional branching, prevents RCE
- `executors/workflow-executor.ts` — launches headless Chromium, runs a full workflow, closes browser

### Frontend Plugin Model

The web app uses `@pluggable-js/react`'s `ActiveWorkspaceView` to dynamically render the `rpa-cockpit` plugin. The plugin registers via `uiRegistry.registerComponent('rpa-workspace-view', ...)` and `pluginRegistry.register(...)`.

### API Gateway

Lambda handler (`apps/api-gateway/src/index.ts`) exposes:
- `POST /workflows` — persists workflow to DynamoDB, enqueues job to SQS
- `GET /workflows/:id` — reads workflow status from DynamoDB

### RPA Worker

`apps/rpa-worker/src/index.ts` polls SQS for workflow jobs, executes them via `executeWorkflow()`, and deletes the message on success. Packaged as Docker image using Playwright's official base image.

## Build & Validation Commands

```bash
# Type-check all projects
npx tsc --noEmit --project libs/automation-core/tsconfig.json
npx tsc --noEmit --project apps/web-platform/tsconfig.json
npx tsc --noEmit --project apps/api-gateway/tsconfig.json
npx tsc --noEmit --project apps/rpa-worker/tsconfig.json

# Run tests
npx vitest run libs/automation-core

# Nx build (requires nx fully installed and configured)
npx nx run-many -t build --projects=api-gateway,rpa-worker,web-platform
```

## Notes

- The `@pluggable-js/*` packages are local stubs. When the real `@pluggable-js` npm packages are published, update `package.json` to point to the npm versions and remove the `libs/pluggable-*` directories.
- Environment variables: `WORKFLOW_TABLE` (DynamoDB), `JOB_QUEUE_URL` (SQS) for api-gateway; `JOB_QUEUE_URL` for rpa-worker.
