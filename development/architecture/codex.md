# Optional local Codex backend

Implementation: [src/codex-assistant.js](../../src/codex-assistant.js), [src/assistant-service.js](../../src/assistant-service.js), routing in [src/server.js](../../src/server.js) and the backend selector in [public/app.js](../../public/app.js).

## Backend ownership

`AssistantService` selects `openworker` or `codex` for a request. The default is `openworker`, preserving the original API/Ollama setup. `AI_BACKEND=codex` changes the initial UI default; the browser remembers an explicit choice in `papertrail.assistantBackend`. Switching backends does not edit either provider configuration, and the service allows only one active answer across both engines.

The OpenWorker engine and its immutable agent identity are unchanged. The Codex engine uses `@openai/codex-sdk@0.169.0`, whose manifest installs the matching `@openai/codex` CLI. The SDK invokes the local executable through its subprocess transport. `CODEX_PATH` overrides the default `codex` command, normally resolved from npm's local bin directory when started through `npm start`. A custom executable must support this SDK's exec/JSONL contract; only version 0.169.0 was exercised here.

## Authentication and configuration

Login happens in the terminal with `npm run codex:login` (or a custom executable's `login`). Papertrail never initiates browser login, reads an auth file, copies credentials, or exposes tokens through the API. The existing Codex home and supported OS credential store remain owned by Codex.

`refreshStatus()` executes `codex login status` with a five-second timeout and 16 KiB output cap. It reports a configured backend only if the command succeeds and identifies ChatGPT authentication. API-key-only authentication is rejected. Results are cached for 30 seconds; concurrent checks share one promise. **Check connection** forces a refresh. A configured flag means login was detected, not that an inference call succeeded.

Only an allowlist of environment variables reaches the CLI: paths/home, locale, temporary storage, Codex/XDG directories, proxy settings and certificate configuration. OpenWorker's `OPENAI_API_KEY` and other API credentials are not forwarded. Per-run configuration explicitly selects OpenAI and `forced_login_method='chatgpt'` to prevent an accidental switch to API-key billing. No API key or base URL is supplied to the SDK.

`CODEX_MODEL` optionally specifies an account-available model; otherwise the CLI's configured/default model is used. `CODEX_TIMEOUT_MS` defaults to 180,000 and accepts integers from 1,000 to 600,000.

## Question lifecycle

Both engines receive the same retrieved excerpts and page IDs; [retrieval](assistant.md#retrieval-before-generation) still honors the active search options. Every Codex question:

1. Checks sign-in and cancellation, then allocates a fresh temporary directory outside the app's repository.
2. Creates an SDK client with bounded developer instructions treating excerpts as untrusted data.
3. Starts a fresh thread in read-only mode, with approvals set to never, web search disabled and sandbox network access disabled. These restrictions do not block the model provider's own inference connection.
4. Supplies the question and up to six retrieved excerpts through stdin via the SDK.
5. Converts `agent_message` item events into replacement `text` updates. Reasoning and tool output are not displayed.
6. Requires `turn.completed` plus a nonempty answer before emitting `done`. Fatal errors, failed turns and an early end never count as success.
7. Removes the temporary directory and releases the busy state.

Codex shell, unified execution, freeform patching, multi-agent, app/plugin and plan features are disabled through per-run configuration; the MCP server map is overridden to empty. Project instructions are disabled for the temporary thread. If a tool-action event nevertheless appears, the adapter aborts the run and reports an error. These application controls are not a claim that arbitrary Node callbacks are sandboxed or that every custom Codex executable has identical enforcement. Managed machine policies can impose additional requirements.

The browser's Stop button closes the HTTP response and aborts the SDK run through `AbortSignal`. Application shutdown aborts and awaits the active run. The answer timeout follows the same cleanup path. A client disconnected during the login check is detected before starting generation. Each question uses a new thread; no cross-question chat memory is implemented. Codex may persist thread history in its own home even though the temporary working directory is removed.

## Verification and limits

The tests use the actual pinned SDK with a deterministic POSIX CLI fixture, exercising stdin, JSONL, configuration flags, environment filtering, streamed/final messages, failure, cancellation, shutdown, timeout and repeated questions. Separate HTTP tests exercise defaults, explicit selection, missing configuration, invalid choices and concurrent requests. Existing OpenWorker fixture tests remain in the suite.

The installed native CLI returned version 0.169.0 and an existing ChatGPT login. A synthetic question was attempted through the SDK, but native Codex failed to initialize its app-server because its local state was read-only in this execution environment. No live model answer was obtained. Browser preview and cross-platform native execution were not exercised. Do not infer live-answer quality from transport fixtures. Use a normal terminal with a writable Codex home to complete the live check; Papertrail reports this case with an actionable error.
