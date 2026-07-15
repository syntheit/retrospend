# Retrospend Platform Expansion: Technical Research Report (2026)

This report synthesizes research across five areas to guide Retrospend's expansion beyond the web app: a React Native mobile client, a public REST API, third-party auth, receipt OCR, and a Linux desktop (libadwaita) client. It is written for a solo developer and prioritizes concrete decisions over exhaustive option coverage.

---

## Executive Summary

- **Expo + React Native remains the right mobile stack.** The 2026 landscape confirms the original `react-native-port.md` analysis. New Architecture (Fabric + JSI) is now the default in Expo SDK 53, eliminating the opt-in friction that was a footnote in earlier planning.
- **A hand-written REST `/api/v1/` layer is the correct public API path.** trpc-openapi forks have maintenance gaps; oRPC requires migrating 200 procedures. Route Handlers in Next.js 15 calling the existing services layer, with OpenAPI generated via `zod-to-openapi`, is the pragmatic choice.
- **better-auth's `apiKey` plugin covers the auth gap cleanly.** Bearer tokens for the mobile client, personal access tokens (PATs) for third-party/script integrations — both are supported without adding OAuth complexity.
- **Receipt storage now, OCR later.** Phase 1 is a nullable `receiptUrl` column and file storage — zero OCR complexity. Phase 2 adds PaddleOCR as a background sidecar. Phase 3 optionally delegates to a user-configured LLM endpoint, using the existing `ai-access.service.ts` infrastructure.
- **A libadwaita desktop client is feasible but depends on the REST API.** Python + PyGObject is the fastest path to a prototype; Rust + relm4 is the right long-term investment. The libadwaita client should never speak tRPC directly — the REST API from Topic 2 is a prerequisite.
- **Build order: REST API + auth before mobile, mobile before desktop.** The REST API is load-bearing infrastructure for both the libadwaita client and third-party integrations.

---

## Topic 1: Mobile Stack (2026 Update)

### Findings

**Expo SDK 53 (May 2025)** made New Architecture (Fabric renderer + JSI + Hermes) the default for all new projects. React Native 0.76+ considers it fully stabilized. This is a meaningful change from the state of things when `react-native-port.md` was written — the "enable New Architecture" step is no longer required. There are no known friction points between New Architecture and `@trpc/react-query` as of 2026.

**Expo Router v4** is now stable and production-ready. Its file-based navigation model mirrors Next.js App Router closely — the mental model transfers directly for a developer already working in Next.js. This was listed as a future direction in earlier planning but can now be adopted without caveats.

**EAS (Expo Application Services)** handles cloud builds (iOS + Android without requiring a Mac) and OTA updates. A monthly free tier exists but has usage limits. Paid plans start around $99/month for higher volume. For a self-hosted personal finance app with a small user base this is unlikely to be a cost concern at launch.

**Server URL configuration:** The user-supplied server URL must be set at runtime, not build time — the app cannot know which Retrospend instance a user is connecting to. This is not a limitation specific to Expo; it is inherent to the self-hosted model.

**Self-hosted "connect to your instance" UX:** The Immich mobile app established this pattern clearly: the first screen is a server URL input, the app validates the endpoint, then proceeds to login. Nextcloud, Paperless Mobile, and Bitwarden all follow the same pattern. Apple App Store review does not prohibit this — the key requirement is that the app must have meaningful function independent of any specific server (i.e., not a blank screen). A "connect your server" onboarding screen with clear instructions and optional demo server satisfies this.

**Alternatives evaluated and rejected:**

- **Flutter:** Good cross-platform UI story and a solid finance charting ecosystem (`fl_chart`, `syncfusion_flutter_charts`). Rejected because Dart is a new language investment and it is impossible to share Zod schemas, tRPC types, or any existing TypeScript business logic. For a solo TypeScript developer this is a high cost for unclear benefit.
- **KMM (Kotlin Multiplatform Mobile):** Shares Kotlin business logic across iOS/Android but requires separate UI code per platform. Irrelevant here since all business logic already lives server-side in tRPC procedures.
- **PWA/Capacitor:** iOS PWA limitations (no push notifications until iOS 16.4+, no background sync, degraded install UX) make it unsuitable for a finance app that intends to use camera access and push notifications. Capacitor improves on raw PWA but still has native module gaps that matter here.

### Recommendation

The original `react-native-port.md` analysis holds. **Use Expo + React Native.** No changes to the monorepo architecture or build order are needed. Concretely:

- Initialize the Expo app with `create-expo-app` using SDK 53+ — New Architecture is enabled by default, nothing extra needed
- Use Expo Router v4 for navigation
- Use `expo-secure-store` for session token storage (already called out in the original analysis)
- EAS Build for distributing to TestFlight and Google Play internal track

### Updates to `react-native-port.md`

The original document mentions "better-auth supports bearer token mode — configure the client to send `Authorization: Bearer <token>` headers" — this is still correct but see Topic 3 for the complete auth picture, including the `apiKey` plugin for PATs.

The charts section lists `victory-native`, `react-native-chart-kit`, and `react-native-skia`. Of these, `react-native-skia`-based solutions have matured significantly by 2026 and are the highest-quality option if development time is available; `victory-native` remains the pragmatic choice for speed.

---

## Topic 2: Public API Strategy (tRPC → REST/OpenAPI)

### Findings

**tRPC v11 HTTP encoding is not a viable public API surface.** Queries use `GET /?input=<JSON-encoded>` and mutations use `POST` with `{"0": {"json": ...}}`. The encoding is awkward for curl/script consumers, and tRPC's versioning story is tied to its own internal contracts, not REST semantics. Documenting this as a public API would be a maintenance burden and a poor developer experience.

**trpc-openapi wrappers:** The original `trpc-openapi` package has had maintenance gaps. As of 2026, actively maintained forks include `trpc-to-openapi` and `@trpc-liminal/open-api`. All of them require adding `.meta({ openapi: { method: 'GET', path: '/expenses' } })` to each procedure. Annotating 200 procedures is a significant one-time investment, and the generated OpenAPI spec is constrained by tRPC's own type model. Not recommended.

**oRPC:** A newer framework (2024–2025) that is OpenAPI-native and tRPC-compatible. It generates OpenAPI specs as a first-class feature and has stronger TypeScript-first design than the trpc-openapi wrappers. However, migrating 200 tRPC procedures to oRPC is a large refactor with meaningful risk of regressions. Not recommended without a dedicated migration window.

**Immich approach:** Immich maintains a separate REST API layer with a hand-maintained OpenAPI YAML spec that generates TypeScript/Python SDKs. They treat the public API as a separate versioned product (v1, v2). The maintenance burden is real; they manage it with a team. Relevant reference point for what maturity looks like, not a direct template.

**Actual Budget approach:** `@actual-app/api` is a Node.js wrapper around Actual's internal protocol — not REST, not curl-friendly. Works for programmatic access but not suitable as a general integration surface.

### Recommendation

**Hand-written REST route handlers on top of the existing services layer.**

Create `/api/v1/` routes using Next.js App Router Route Handlers. These handlers call the same service functions that tRPC procedures call — not the tRPC procedures themselves. Use Zod for input/output validation (already present throughout the codebase). Generate an OpenAPI spec from those Zod schemas using `@asteasolutions/zod-to-openapi`.

This approach gives:
- A versioned REST API that can evolve independently of internal tRPC procedures
- An OpenAPI spec suitable for SDK generation (TypeScript client for the libadwaita client generator, Python client, etc.)
- No leakage of tRPC internal encoding into the public surface
- Proper HTTP semantics (status codes, methods, pagination headers)

**Scope: start with 15–20 endpoints, not all 200 procedures.** Prioritize: create/read/update/delete expenses, list expenses with date and category filters, budgets, currencies, user profile. The import, admin, and bulk operations can stay tRPC-only for now.

**The mobile app continues to use tRPC directly.** The REST API is for third-party integrations and the libadwaita client. There is no reason to route the mobile app through REST when it can have full type safety via `@trpc/react-query`.

---

## Topic 3: Auth for Third-Party and Native Clients

### Findings

**better-auth `apiKey` plugin:** better-auth has an `apiKey` plugin available since v0.9+. It provides personal access tokens with: configurable prefix, optional expiry, per-key rate limiting, and metadata/scopes. This maps directly to the "Settings > API Keys" UX pattern common in developer tools (GitHub PATs, Grafana service accounts, etc.). The plugin stores a hashed version of the key — the project already has `hashToken()` in `src/server/lib/tokens.ts`, so the infrastructure is aligned.

**Bearer token mode for mobile:** better-auth session tokens can be used as bearer tokens by configuring `useCookies: false` on the client. The mobile client then sends `Authorization: Bearer <session_token>` instead of relying on cookies. This is already documented in `react-native-port.md` and is the correct approach.

**OAuth provider plugin:** better-auth has an `oAuthProvider` plugin (experimental in v1.x, trending toward stable in 2026). This allows acting as an OAuth 2.0 provider — i.e., "Sign in with Retrospend". For a personal finance app with a single owner, this adds complexity without clear benefit. Skip for now.

**Device Authorization Grant:** Not natively supported in better-auth as of 2026. Would require a custom implementation or a separate OAuth library. Not needed given the simpler alternatives.

**Config location:** `src/server/better-auth/config.ts` is where plugin additions go. Adding `apiKey()` to the plugins array is a small, contained change.

### Recommendation

Two auth mechanisms, both using better-auth:

1. **Mobile app:** Bearer token mode (`useCookies: false`). User logs in with username/password through the "connect to your server" onboarding flow; the session token is stored in `expo-secure-store`. Token expiry is 7 days (existing default) — handle refresh or re-login gracefully in the app.

2. **Third-party integrations / scripts:** Add the `apiKey` plugin to `src/server/better-auth/config.ts`. Expose a "Developer" or "API Keys" section in Settings. Users generate named tokens with optional expiry; tokens are shown once at creation and hashed in storage. All REST `/api/v1/` endpoints accept either a session cookie or `Authorization: Bearer <api_key>`.

Skip the OAuth provider. It is not wrong, but it adds a meaningful surface area for a solo developer to maintain with no clear immediate use case.

---

## Topic 4: Receipt Upload and OCR

### Findings

**Storage infrastructure already exists.** `src/server/services/storage.ts` already handles `uploadFile`, `deleteFile`, and `getFileStream` using `UPLOAD_DIR`. The image serving endpoint `/api/images/[...path]` is already HTTP-based. Phase 1 requires almost no new infrastructure.

**OCR option landscape:**

| Option | Accuracy | Infra cost | Notes |
|---|---|---|---|
| Tesseract v5 | ~70–80% on real receipts | Minimal | Poor on crumpled/angled receipts, handwriting |
| PaddleOCR | ~90%+ on clean receipts | ~500MB–1GB sidecar | Python-based, handles rotated text and complex layouts |
| docTR | Research-quality | Moderate | Less community tooling than PaddleOCR |
| LLM Vision (local: Llama 3.2 Vision 11B, Qwen2.5-VL 7B) | High — structured JSON extraction | 8–16GB VRAM | 2–10s per image; Ollama-compatible |
| LLM Vision (API: GPT-4o / Claude 3.5 Sonnet) | 95%+ | ~$0.01–0.03/receipt | Fastest integration if user supplies API key |

The project already has `src/server/services/ai-access.service.ts`, which implies there is an abstraction layer for AI provider configuration. This is the right hook for Phase 3.

**Reference projects:**
- Paperless-ngx uses Tesseract by default (swappable) for full-document indexing, not structured extraction. Different use case.
- Firefly III has no built-in OCR. Community integrations exist with Paperless-ngx for storage.
- Neither is a direct template for structured expense extraction.

**Job queue:** The import queue service already exists (`import-queue.service`). Background OCR jobs can use the same infrastructure.

### Recommendation (phased)

**Phase 1 — Storage only (build now):**
- Add nullable `receiptUrl String?` column to the Expense table in Prisma
- Accept JPEG/PNG up to 10MB; store in `UPLOAD_DIR/receipts/`
- Serve via the existing `/api/images/` endpoint
- Add receipt photo capture to the mobile app (Expense create/edit screen) using `expo-image-picker`
- Zero OCR complexity

**Phase 2 — Background OCR (later):**
- Add PaddleOCR as a Docker sidecar (already using Docker Compose; `docker-compose.yml` is present)
- On receipt upload, queue a background job via the existing import queue
- Return a structured suggestion: `{ merchant?, amount?, date?, currency? }` for user review and confirmation — never auto-fill silently
- Default to PaddleOCR; optionally allow Tesseract fallback for lower-resource environments

**Phase 3 — LLM vision (optional):**
- Extend settings to accept an Ollama URL or OpenAI-compatible endpoint
- Route vision extraction through `ai-access.service.ts`
- For users who supply an API key (e.g., OpenAI), offer the highest-quality extraction path
- This is a power-user feature; don't block Phase 1 or Phase 2 on it

---

## Topic 5: Libadwaita Desktop Client

### Findings

**Language + framework options:**

| Stack | Maturity | Async HTTP | Tooling | Notes |
|---|---|---|---|---|
| Python + PyGObject | High | aiohttp | GNOME Builder, Blueprint | Lowest barrier; many production GNOME apps |
| Rust + gtk-rs + relm4 | High (relm4 v0.9, 2025) | reqwest | Blueprint works | Best long-term; steeper learning curve |
| Vala | Medium-low | Limited | Declining community | Not recommended for new projects |
| GJS (GNOME JS) | Low for this use case | Soup (limited) | Available | Cannot use npm; not suitable for API-heavy client |

Loupe (GNOME image viewer) and Fractal (GNOME Matrix client) are production examples of Rust + gtk-rs. Python examples include Dialect and Mousai.

Blueprint (declarative GTK4 UI markup, compiles to XML) works with all four backends and is strongly recommended over hand-written XML.

**API requirements from the client's perspective:**
- REST with JSON — tRPC's HTTP encoding is too awkward for a non-JavaScript client
- Cursor-based or page-based pagination with `X-Total-Count` header
- ISO 8601 dates in query parameters
- OpenAPI spec for generating a typed client (`openapi-generator` for Rust or `openapi-python-client` for Python eliminates significant boilerplate)
- Correct HTTP status codes: 401 for unauthenticated, 422 for validation errors, etc.
- ETag / Last-Modified for caching (nice to have; not blocking for v1)
- SSE or WebSocket for live updates (polling is acceptable for v1)

This list makes it clear: **the libadwaita client cannot be built until Topic 2's REST API exists.** There is no reasonable path for a Rust or Python GTK app to consume tRPC's HTTP protocol.

### Recommendation

**Python + PyGObject** is the recommended starting point. Reasons:
- Fastest path from zero to a working prototype
- GTK4/Adwaita bindings are complete and stable
- Async HTTP via aiohttp is well-understood
- `openapi-python-client` can generate a typed Python client from the OpenAPI spec produced in Topic 2
- If the developer later wants to rewrite in Rust for performance or distribution, the REST API contract stays the same — the rewrite doesn't require API changes

**Rust + relm4** is the right long-term investment if the developer plans to distribute the client through Flathub or maintain it seriously. Make this choice after the Python prototype validates the UX.

---

## Cross-Cutting Dependencies

The five topics are not independent. Here is how they connect:

```
better-auth apiKey plugin (Topic 3)
        │
        ▼
REST /api/v1/ layer (Topic 2)  ◄──── Required by libadwaita client (Topic 5)
        │
        ▼
OpenAPI spec (Topic 2)  ─────────────► openapi-python-client / openapi-generator
                                               │
                                               ▼
                                    libadwaita Python/Rust client
```

```
Mobile app (Topic 1)
        │
        ├── uses tRPC directly (@trpc/react-query) — no REST dependency
        ├── uses bearer token mode (Topic 3)
        └── uses receipt photo upload → receiptUrl (Topic 4, Phase 1)
```

Key implications:
- **Do not start the libadwaita client before the REST API exists.** Without Topic 2 done, the desktop client has no viable API to consume.
- **The mobile app is decoupled from the REST API.** It uses tRPC directly and is independently buildable once auth (Topic 3) is set up.
- **Receipt OCR Phase 2 and Phase 3 are independent of all other topics** — they are backend-only changes that any client benefits from without any client-side changes.

---

## Recommended Build Order

This ordering minimizes rework and unblocks parallel workstreams as the project grows.

### Stage 1 — Foundation (do first)

1. **better-auth `apiKey` plugin** — Add to `src/server/better-auth/config.ts`. Small change, high value: unblocks PATs and the REST API auth layer.
2. **REST `/api/v1/` skeleton** — Create the Route Handler structure, wire up auth middleware (accept session cookie or `Authorization: Bearer <api_key>`), and set up `zod-to-openapi` generation. Start with 5 endpoints (expenses CRUD + list) to validate the pattern before expanding.
3. **Receipt storage (Phase 1)** — Add `receiptUrl` to Prisma schema, wire up upload endpoint. Self-contained, low risk.

### Stage 2 — Mobile

4. **Monorepo restructure** — Follow the structure in `react-native-port.md` Section 5 (`apps/web`, `apps/mobile`, `packages/shared`, `packages/api`).
5. **Expo app initialization** — SDK 53+, Expo Router v4. New Architecture is default.
6. **Auth flow** — "Connect your server" onboarding screen → login → bearer token stored in `expo-secure-store`.
7. **Core screens** — Follow the build order in `react-native-port.md` Section 7 (dashboard → transactions → expense CRUD → budget → wealth → people → projects).
8. **Receipt photo capture** — Add to expense create/edit after Phase 1 storage is live.

### Stage 3 — REST API expansion + desktop

9. **Expand REST API to full initial scope** — 15–20 endpoints covering all primary resources.
10. **OpenAPI spec** — Publish at `/api/v1/openapi.json`. Generate Python client.
11. **libadwaita prototype** — Python + PyGObject, using the generated client. Target: expenses list, create expense, basic dashboard.

### Stage 4 — Enhancements

12. **OCR Phase 2** — PaddleOCR sidecar, background job, suggestion UI.
13. **Push notifications** — Mobile only; needs `notification.registerDevice` procedure (already noted in `react-native-port.md`).
14. **OCR Phase 3** — LLM vision via `ai-access.service.ts`, user-configurable.

---

## Notes on `react-native-port.md` Accuracy

The original analysis holds well. Specific items to update:

- **New Architecture note:** The document does not mention New Architecture. Add a note that Expo SDK 53+ enables it by default — no configuration needed.
- **Expo Router:** The document mentions "Expo Router for file-based navigation" as a recommendation but does not call out v4 stability. Expo Router v4 is now production-ready; no caveats needed.
- **Charts:** `react-native-skia`-based charting has matured significantly and is worth re-evaluating against `victory-native` before committing.
- **Auth section (4D):** The bearer token description is correct. Add a reference to the `apiKey` plugin for PATs — the document only addresses the mobile session case, not third-party script access.
- **Missing topics:** The original document does not address the public API surface or the libadwaita client path. This report fills those gaps.
- **35–40% reuse estimate:** Still accurate. No research from any topic contradicts this figure.
