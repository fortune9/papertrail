# Optional OpenWorker assistant

Implementation: [src/assistant.js](../../src/assistant.js), the `/api/ask` route in [src/server.js](../../src/server.js), and the streamed-response reader in [public/app.js](../../public/app.js).

This page describes the unchanged OpenWorker engine and shared retrieval. The [local Codex backend](codex.md) is an independent selectable alternative. [AssistantService](../../src/assistant-service.js) defaults to OpenWorker, validates backend IDs and coordinates busy state/shutdown. Selecting Codex does not replace or reconfigure the OpenWorker agent.

## Retrieval before generation

The browser submits a question, selected backend, current search query and checkbox options (case-insensitivity, fuzzy spelling and fields). The server uses the query when nonempty, otherwise the question, to call the same [search](search.md) as the library UI with those options. It takes up to six ranked papers, filters those to `ready` status, and loads up to 10,000 characters from each selected matching page. Filtering happens after selecting six candidates, so fewer than six usable sources may remain. Field scope constrains retrieval; model excerpts still use original page text, which may differ from manually corrected metadata. Both backends use this same source selection and browser source list.

There is one excerpt per paper, not full-document context. Citations use `[Paper ID, p. N]`. The server streams a separate source list containing trusted database IDs and page numbers; the browser uses those for PDF links. A question with no retrieved usable text is rejected rather than sent without sources.

## Harness lifecycle

The pinned SDK is `@openworkerai/harness-sdk@0.1.0-beta.4`, whose optional dependency manifest selects native runtime packages at `0.1.0-beta.3`. Node starts the managed Rust process lazily with `Harness.start`, using `<DATA_DIR>/harness` as its durable state and `sandbox: 'off'`.

The provider is registered as `PaperProvider-v1`. Configuration comes from `AI_MODEL`, `AI_BASE_URL`, `AI_API` and `OPENAI_API_KEY`. The default remote endpoint uses OpenAI Responses; a custom base URL defaults to Chat Completions. Credentials are read by Node and supplied through memory-only provider configuration. They are not sent to browser code.

The class also accepts injected environment, executable and identity options for [desktop packaging](desktop.md). The desktop uses explicit bundled runtime paths and main-process settings, with distinct provider/agent names hashed from model/API/endpoint. Keys are supplied as memory-only credential values. Changing desktop settings stops the prior engine and creates a new one; browser defaults and existing durable identities are preserved.

The immutable agent `paper-reader-v1` is registered once and reused. It has no tools, planning, optional memory or scheduling. Its instructions require using supplied evidence, citing pages, acknowledging insufficient evidence, and treating paper content as untrusted data. Changing immutable agent definition fields requires a new agent name.

Each question creates a fresh session; the UI does not implement follow-up conversation history. Sessions remain durably stored by OpenWorker, so disabling the agent's optional memory does not erase question/excerpt history.

## Streaming, errors and cancellation

`session.send` returns a run. Each event is applied to SDK `AttemptOutput`, and the accumulated display text replaces the browser's answer. After events finish, the app checks `run.result()`: only status `completed` emits a successful `done` message. Final output reconciles the streamed text instead of being appended again. Errors emit an error message in the NDJSON stream.

The browser Stop button aborts its fetch. A closed server response aborts the request signal, which calls `session.cancel()`. Concurrent questions are rejected while an answer is active. Application shutdown cancels an active session and shuts down the harness.

Only explicit AI requests transmit retrieved excerpts to the configured model provider. Local import and search do not call it. Answers and model-created citations are not independently fact-checked; links make the underlying evidence inspectable. Deterministic tests verify control flow, not model answer quality.
