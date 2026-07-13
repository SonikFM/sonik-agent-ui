# Copy-retrofit spec extraction: dify-plugin-daemon

Donor repo: `langgenius/dify-plugin-daemon` (Go), read at
`/Users/danielletterio/Documents/GitHub/dify-plugin-daemon`.

**License: Apache License 2.0** (repo-root `LICENSE`, standard Apache-2.0
header confirmed). Permissive — pattern-porting spec knowledge (not lifting
code) into a proprietary TypeScript codebase carries no obligation beyond the
usual "don't copy their code verbatim without attribution if you do lift
literal text," which none of the three items below do. Clear to proceed.

These are **pattern ports**, not code lifts: Go → TypeScript, zip-container →
JSON-manifest, RPC-tunnel → in-process controller call. Each section extracts
the donor's mechanism precisely enough to implement from, then states what
Sonik deliberately changes and why.

---

## Item 1 — Content-addressed package identity (`identity@sha256`)

**Sources:**
`pkg/plugin_packager/decoder/helper.go:363-391` (`Checksum`, `UniqueIdentity`),
`pkg/plugin_packager/decoder/checksum.go:1-46` (`CalculateChecksum`),
`pkg/entities/plugin_entities/identity.go:14-96` (`PluginUniqueIdentifier`,
grammar regexp, accessors),
`pkg/entities/plugin_entities/plugin_declaration.go:274-276` (`Identity()`),
`internal/core/plugin_manager/packages.go:31-206` (`PreparePackage`,
`PersistPackage`, `rollbackPreparedPackage`, `isUniqueViolation`).

### Extracted spec

**Identifier grammar.** A plugin's unique identifier is a single string:

```
[author/]name:version@checksum
```

validated by
`^(?:([a-z0-9_-]{1,64})\/)?([a-z0-9_-]{1,255}):([0-9]{1,4})(\.[0-9]{1,4}){1,3}(-\w{1,16})?@[a-f0-9]{32,64}$`
(`identity.go:22-24`). `author/name:version` (the "identity") comes from
`PluginDeclaration.Identity()`, which is just `MarshalPluginID(author, name,
version)`. `checksum` is appended with `@` by `UniqueIdentity()`
(`helper.go:378-391`): `fmt.Sprintf("%s@%s", identity, checksum)`. The
identifier is therefore **manifest-declared identity, content-hash-suffixed**
— not a pure content hash (two builds of the same version-number but
different bytes get different final identifiers; two builds with identical
bytes but a bumped version number also differ, because `version` is inside
the identity half).

**Hashing scope — exactly which bytes.** `CalculateChecksum`
(`checksum.go:10-45`) is a two-level hash, not a flat hash of concatenated
file bytes:

1. `Walk` every file in the package; for each, compute `sha256(content)`
   keyed by its full relative path (`path.Join(dir, filename)`).
2. Sort the **path keys** lexicographically (`slices.Sort`) — this makes the
   result independent of filesystem/zip enumeration order, unlike the signer
   in Item 3, which deliberately does *not* sort (see that section).
3. Build one buffer: for each sorted path, append `sha256(pathBytes)` then
   `sha256(contentBytes)` — 64 bytes per file, path-hash then content-hash.
   Hashing the *path itself* into the buffer means renaming a file (even with
   byte-identical content) changes the checksum.
4. Final checksum = `hex(sha256(thatBuffer))`.

This is a flat Merkle-style aggregate: order-independent (sorted), but
tamper-evident on both filenames and content. `Checksum()` on the decoder
memoizes this (`helper.go:363-376`) so it's computed once per decode.

**Idempotency semantics** — where they actually enforce it, in
`PersistPackage` (`packages.go:77-150`), not in the identifier format itself:

- `packageBucket.Exists(id)` is checked first; if the blob already exists,
  the existing bytes are captured as `previousPackage` purely for rollback,
  not as a short-circuit — the save proceeds and overwrites with (byte-
  identical, since the id is content-derived) data. The identifier format is
  what makes this safe: re-uploading identical content always resolves to
  the same id, so "upload" is naturally idempotent at the storage layer —
  there's no way to accidentally clobber a *different* package version under
  the same key.
- The DB row (`models.PluginDeclaration`) is created with a **check-then-
  insert-with-fallback** pattern, not a transaction: `GetOne` first; if
  `ErrDatabaseNotFound`, `Create`; if `Create` fails with a Postgres unique-
  violation (SQLSTATE 23505, matched by string on the error, `packages.go:
  198-206` `isUniqueViolation`), that's treated as **success** (another
  goroutine won the race) — it re-reads to confirm and returns the existing
  declaration rather than propagating the error. This is explicit handling
  of concurrent-insert races on a content-addressed key, which is exactly
  the failure mode content-addressing invites (many callers computing the
  same id concurrently).
- `SavePackage` (`packages.go:152-167`) additionally guards against
  **identity spoofing**: it requires the caller-supplied
  `plugin_unique_identifier` to `==` the value the server independently
  recomputes from the uploaded bytes (`prepared.UniqueIdentifier !=
  plugin_unique_identifier` → hard error). A client cannot claim an id that
  doesn't match the content it's uploading.
- Failure at any step triggers `rollbackPreparedPackage` (`packages.go:
  173-196`), which deletes only what it itself created this call (remapped
  asset IDs, the DB row if this call created it, the blob if this call wrote
  it and nothing else since claimed it) — a manually-tracked compensating
  transaction, not a DB transaction, because the blob store and the DB are
  different systems.

### What Sonik adopts vs. deliberately changes

Sonik's `packageVersionId` (`packages/tool-contracts/src/marketplace.ts:74`)
is currently pure semver: `packageId@semver`, and `manifestHash` (`marketplace.ts:72`,
`sha256:[a-f0-9]{64}`) already exists as a **separate** field on
`marketplacePackageVersionSchema`, cross-checked against
`manifest.manifestHash` only via same-payload schema `superRefine`
(`marketplace.ts:602-604`) — i.e., today it verifies the two fields the
*client submitted* agree with each other, never that either matches a
server-recomputed hash of the actual payload bytes.

**Adopt:**
- The **hashing-scope algorithm** verbatim as the shape for
  `manifestHash`: canonicalize the manifest to stable-key-order JSON, sha256
  it. For `kind: "bundle"` packages with multiple `embeddedDefinitions`,
  adopt the sorted-path double-hash (path-hash + content-hash per embedded
  definition, keyed by its id, sorted, concatenated, re-hashed) so the
  aggregate hash is independent of JS object key insertion order and binds
  each embedded definition's *id* into the hash the same way dify binds
  filenames.
- The **identity-spoofing guard**: at package-version ingest, recompute
  `manifestHash` server-side from the submitted manifest bytes and reject if
  it disagrees with the client-submitted `manifestHash` — closing the gap
  the current same-payload `superRefine` leaves open.
- The **idempotent-upload semantics**: if a `packageId` + recomputed
  `manifestHash` pair already exists, treat re-submission as a no-op success
  (return the existing version row) rather than a uniqueness error — mirrors
  `PersistPackage`'s exists-check-but-proceed plus the unique-violation-is-
  success handling for concurrent submits.

**Deliberately change:**
- **Don't** fold the content hash into `packageVersionId` itself. Dify's
  identifier is the *only* handle plugins are addressed by everywhere
  (storage key, DB key, RPC payloads), so content-addressing it is load-
  bearing. Sonik's `packageVersionId` is referenced all over
  `marketplace.ts` (`bundleCompositionItemSchema`, `sourcePackageVersionId`,
  `installedVersionId`, dependency pinning) specifically *because* it's
  human-readable semver — that's what lets a dependency graph express
  `>=1.2.0`-style pinning and lets a human read an install log and know what
  version is running. Replacing it with a hash loses that. Instead, keep
  `manifestHash` as the sibling content-address field it already is, and
  give it dify's hashing rigor and idempotency guarantees rather than
  dify's *placement* in the identifier string.
- No blob-store rollback tracking needed initially — Sonik's package-version
  rows are likely a single DB write (manifest is JSON, not a multi-file
  zip+asset-bucket+DB triad), so there's no multi-system compensating-
  transaction problem to port unless/until package bodies grow multi-file
  bundle bodies with separate blob storage.

**Estimated Sonik-side size:** small. A canonical-JSON-hash utility (~20-30
LOC, no new dependency — Node's `crypto.createHash("sha256")` plus a stable
stringify, which may already exist in the repo — check before adding one),
a server-side recompute-and-compare guard at version-ingest, and an
idempotent-upsert instead of insert-or-fail. Rough: 60-120 LOC + tests.
**0.5–1 day.**

---

## Item 2 — RPC-boundary per-call permission dispatch table

**Sources:**
`internal/core/io_tunnel/backwards_invocation/task.go:19-69` (`InvokeDify`,
the single entry point), `task.go:71-176` (`permissionMapping`),
`task.go:178-196` (`checkPermission`), `task.go:229-283` (`dispatchMapping`),
`task.go:300-325` (`dispatchDifyInvocationTask`).

### Extracted spec

**Shape: two parallel maps keyed by the same enum**
(`dify_invocation.InvokeType`), evaluated at two different times:

1. `permissionMapping: InvokeType -> {func: (declaration) bool, error: string}`
   — consulted **synchronously, before dispatch**, inside `checkPermission`
   (`task.go:178-196`), called directly from `InvokeDify` (`task.go:53-57`)
   — the single function every backwards-invocation request passes through
   regardless of caller or session. On failure: `WriteError` +
   `EndResponse`, and the request never reaches step 2 — no goroutine is
   even spawned.
2. `dispatchMapping: InvokeType -> handler` — consulted only *after*
   `checkPermission` returns nil, and only inside a submitted goroutine
   (`routine.Submit`, `task.go:60-66`) that actually performs the host
   action (invoke a tool, call an LLM, touch storage, etc.).

**Fail-closed on unknown type.** `checkPermission` looks up the invoke type
in `permissionMapping`; if absent, it returns a hard error — "unsupported
invoke type" — rather than defaulting to allow (`task.go:181-184`).
`dispatchDifyInvocationTask` does the same fail-closed lookup against
`dispatchMapping` (`task.go:317-324`).

**What each predicate checks.** Every entry reads a boolean straight off
`declaration.Resource.Permission` — the plugin's *manifest-declared* static
capability flags (`AllowInvokeTool()`, `AllowInvokeLLM()`, etc.,
`task.go:73-176`) — never anything from the inbound request payload itself.
The request cannot self-escalate; the only input to the permission decision
is the immutable, previously-validated plugin declaration passed in by the
caller (`checkPermission(declaration *plugin_entities.PluginDeclaration,
requestHandle *BackwardsInvocation)`).

**Anti-pattern — the upload-file always-allow gap** (`task.go:157-162`):

```go
dify_invocation.INVOKE_TYPE_UPLOAD_FILE: {
    "func": func(declaration *plugin_entities.PluginDeclaration) bool {
        return true
    },
    "error": "permission denied, you need to enable storage access in plugin manifest",
},
```

The predicate ignores `declaration` entirely and always returns `true` — any
plugin, including one that declares **zero** resource permissions, can
upload files through the backwards-invocation channel. The `error` string is
actively misleading: it describes a storage-access gate that this entry does
not implement (contrast with the real `INVOKE_TYPE_STORAGE` entry two cases
above, which *does* call `AllowInvokeStorage()`). This reads as boilerplate
drift: someone added the map *entry* (required, or the fail-closed lookup
rejects the invoke type) but stubbed the predicate "for now," and the visual
symmetry of the two parallel maps was never enough to force anyone to notice
the predicate was a stub — the map *shape* is enforced, the map *semantics*
are not.

### What Sonik adopts vs. deliberately changes

Sonik already has the two ingredients dify's two maps correspond to, but
they aren't wired together at a real call chokepoint yet:
- `evaluateCapabilityAccess` (`packages/tool-contracts/src/
  capability-registry.ts:142-176`) is the per-call, fail-closed,
  default-deny predicate — direct analog of one `permissionMapping` entry,
  generalized to a registry lookup instead of a hardcoded switch. It already
  returns `{mode:"off", reason:"capability_not_registered"}` for unknown
  ids, matching dify's fail-closed unknown-type behavior.
- `resolveEffectivePinnedCapabilities` (`capability-pinning.ts:43-65`) calls
  it once **per run**, at run start, and freezes the result (per its own
  doc comment, `capability-pinning.ts:1-17`) — this is dify's *manifest
  declaration* layer (static, resolved once from what the plugin/run
  declared), not dify's *per-call RPC-boundary* layer.
- Nothing today plays the role of `checkPermission` gating
  `dispatchDifyInvocationTask` — `resolveEffectivePinnedCapabilities` has
  exactly one non-test caller, itself never called from anywhere; grepping
  the whole repo for its call sites turns up only its own definition and
  comment references in `grant-synthesis.ts`. The actual command execution
  chokepoint, `apps/standalone-sveltekit/src/lib/server/
  host-command-runtime.ts` (1153 lines, `executeGeneratedOpenApiReadCommand`
  / `executeGeneratedOpenApiWriteCommand` at lines 200 and 245, plus the
  `HostCommandAdapter` factories below), executes generated OpenAPI commands
  without consulting either function. This is the same gap-shape as dify's
  upload-file stub, one level up: the map/registry exists and is correct,
  but nothing structurally forces every execution path through it.

**Adopt:**
- Insert a single gate call, mirroring `checkPermission` gating
  `dispatchDifyInvocationTask`, at the one place `host-command-runtime.ts`
  actually invokes a command body (inside or immediately wrapping
  `executeGeneratedOpenApiReadCommand` / `...WriteCommand`, and any future
  `HostCommandAdapter`): call `evaluateCapabilityAccess` (or consult the
  already-frozen `PinnedCapabilities` from `resolveEffectivePinnedCapabilities`
  if a run-scoped freeze is in scope) keyed by the command's `capabilityId`,
  and refuse to execute (`mode !== "allow"`, or `mode === "ask"` without a
  fresh approval token) *before* the adapter body runs — not after, not
  advisory-only.
- Keep run-start pinning (`resolveEffectivePinnedCapabilities`) as-is; it's
  the equivalent of dify's static manifest-declared permission check. Add
  the per-call chokepoint as the *second*, structurally-unavoidable layer —
  the point of porting this pattern isn't that the answer changes call to
  call (usually it won't, since the pin is frozen for the run), it's that
  **no execution path can reach the adapter body without passing through
  the gate**, which is not true of the current wiring.
- Explicit anti-pattern to forbid in review: no `capabilityId -> () => true`
  style "trusted internal call" bypass predicate anywhere in the dispatch
  wiring. If a command genuinely needs no gating, express that by
  registering it with `effect: "none"` in the capability registry (which
  `evaluateCapabilityAccess` still requires an explicit grant for — default-
  deny holds even for `none`-effect capabilities), not by special-casing it
  out of the check the way dify's upload-file entry does.

**Deliberately change:**
- No hardcoded Go-style switch/map literal of predicates — Sonik already has
  the more general registry+grants+implication model
  (`capability-registry.ts`), which is a strict superset of what dify's flat
  map does (dify has no implication graph, no kill-switch, no most-
  restrictive-wins across multiple grant sources). Port the *wiring
  discipline* (one chokepoint, fail-closed, no bypass predicates), not the
  data structure.

**Estimated Sonik-side size:** medium — the check logic itself
(`evaluateCapabilityAccess`) already exists and is unit-tested; the work is
threading `capabilityId` onto each generated command/adapter (verify whether
`command-catalog.ts` / the OpenAPI generation step already tags this — not
confirmed in this pass) and inserting the one wrapper call at the
`host-command-runtime.ts` chokepoint, plus a deny-path test per adapter
kind. Rough: 150-300 LOC across `host-command-runtime.ts` + tests, most of
it from touching an already-1153-line file carefully rather than from
algorithmic difficulty. **1–2 days.**

---

## Item 3 — Offline RSA signature over file-hashes + timestamp

**Sources:**
`pkg/plugin_packager/signer/sign.go:16-26` (`SignPlugin`),
`pkg/plugin_packager/signer/withkey/sign_with_key.go:22-133`
(`SignPluginWithPrivateKey`), `pkg/plugin_packager/decoder/verifier.go:17-115`
(`VerifyPlugin`, `VerifyPluginWithPublicKeyPaths`,
`VerifyPluginWithPublicKeys`), `pkg/plugin_packager/decoder/helper.go:
497-520` (`verified()` — the enablement/enforcement wiring),
`pkg/plugin_packager/decoder/zip.go:35-38,121-135,227-259`
(`ThirdPartySignatureVerificationConfig`, `Walk`, `Signature`/`CreateTime`
memoized parse), `pkg/utils/encryption/rsa.go:16-24` (`RSASign`/`VerifySign`
primitives), `pkg/plugin_packager/consts/verification.go:4`
(`VERIFICATION_FILE = ".verification.dify.json"`),
`internal/core/plugin_manager/packages.go:63-66` (verification capture at
prepare time — the only place enforcement *could* bite, and doesn't).

### Extracted spec

**Signing payload construction** (`sign_with_key.go:22-133`):

1. `Walk` every file in the **source** package in zip-directory enumeration
   order (`zip.go:121-135` — iterates `z.reader.File` in archive order,
   *not* sorted, unlike `CalculateChecksum` in Item 1). For each file:
   `sha256(fileBytes)`, append the raw 32-byte digest to a running buffer
   `data` via simple concatenation (`sign_with_key.go:46-52`) — a flat
   hash-of-hashes, no tree structure, order-dependent by construction.
2. Simultaneously re-write every file into a fresh zip (`sign_with_key.go:
   54-63`) — signing produces a new archive, it doesn't mutate the input.
3. If a `Verification` (authorized-category claim, e.g. "this is an
   official langgenius-published plugin") is supplied: marshal it to JSON,
   write it into the **new** zip as a real file at
   `.verification.dify.json`, `sha256` that JSON blob, and append that
   digest to `data` too (`sign_with_key.go:72-97`). Because this file is
   written into the zip *being built*, not the source being walked in step
   1, its hash has to be appended manually here — it wasn't picked up by
   the Item-1-shaped walk. This makes the verification claim itself part of
   what's signed: you can't detach a "verified" marker and staple it onto a
   different (or tampered) package.
4. Take current unix timestamp `ct = time.Now().Unix()`; append its decimal
   ASCII string bytes to `data` (`sign_with_key.go:99-106`).
5. `signature = RSASign(privateKey, data.Bytes())`. `RSASign`
   (`encryption/rsa.go:16-19`) is **not** "sign the raw concatenation
   directly" — it takes `data`, computes `sha256.Sum256(data)` itself, and
   RSA-PKCS1v15-signs *that* single 32-byte digest with SHA-256 as the
   hash-id (`rsa.SignPKCS1v15(..., crypto.SHA256, hashed[:])`). So the real
   structure is: sign = RSA-PKCS1v15(sha256(concat(sha256(file_1), ...,
   sha256(file_n), [sha256(verification_json)], timestamp_ascii))). RSA
   key size is 4096 bits per the doc comment (`sign.go:12-13`); not
   independently re-verified in the excerpt but stated as the design intent.
6. The signature (base64) and the timestamp are written into the **zip
   comment field** as JSON `{"signature": ..., "time": ...}`
   (`sign_with_key.go:114-121`) — sibling metadata on the container, not a
   file inside the hashed content. This sidesteps a circularity: you can't
   hash something that includes its own not-yet-computed signature.

**Verification flow** (`verifier.go:64-115`):

1. Re-`Walk` the **final signed** zip (which now genuinely contains
   `.verification.dify.json` as an ordinary file, added at the same
   position — after all original files — that step 3 above manually
   appended its hash at). Because `Walk` iterates `z.reader.File` in the
   zip's stored order and doesn't special-case or skip the verification
   filename, the per-file loop naturally re-derives the identical byte
   sequence sign-time built by hand: `concat(sha256(file_1), ...,
   sha256(file_n), sha256(verification_json))`. This is a real symmetry,
   not a coincidence — worth calling out explicitly since it isn't obvious
   from reading either function in isolation.
2. Read the signature and timestamp back via `decoder.Signature()` /
   `decoder.CreateTime()` (`zip.go:227-259`), which lazily parse the zip
   comment JSON once and memoize.
3. Append the timestamp's decimal ASCII string to `data`, matching step 4
   of signing exactly.
4. Base64-decode the signature; `VerifySign(publicKey, data.Bytes(),
   sigBytes)` — same internal `sha256.Sum256` + PKCS1v15 shape as signing,
   mirrored (`encryption/rsa.go:21-24`).
5. Multi-key support: `VerifyPlugin` tries only the bundled official public
   key (`verifier.go:19-31`); `VerifyPluginWithPublicKeyPaths` tries the
   official key **plus** any operator-supplied key paths, first match wins
   (`verifier.go:33-60,106-114`) — i.e., "verified" means "signed by *any*
   trusted key," not "signed by *the* trusted key," which matters if an org
   wants to accept both official and internally-signed packages.

**The off-by-default enforcement anti-pattern** — this is the load-bearing
finding, and it's not in the signature math, it's in how the result is
*used*:

- `verified()` (`helper.go:497-520`) is the only place `VerifyPlugin`/
  `VerifyPluginWithPublicKeyPaths` actually gets called during normal
  decode. It sets `dec.Verified = p.verified(decoder)` on the manifest
  (`helper.go:337`) — a **boolean metadata field**, not a gate. Whether it's
  `true` or `false`, decoding proceeds identically.
- Third-party key verification is itself gated behind
  `ThirdPartySignatureVerificationConfig{Enabled bool, PublicKeyPaths
  []string}` (`zip.go:35-38`) — a Go struct whose zero value is
  `Enabled: false`. Unless a caller explicitly constructs and passes this
  config with `Enabled: true`, only the bundled official key is even tried.
- Crucially, **no code path anywhere in the excerpted flow rejects a
  package for failing verification.** `PreparePackage`
  (`packages.go:63-66`) only *conditionally captures* a `Verification`
  struct if `packageDecoder.Verified()` is true; if it's false, `verification`
  stays `nil` and the function keeps going — the package is still decoded,
  its manifest still validated, still persisted. An unsigned or invalid-
  signature package is fully accepted into the system; the only
  consequence is a `Verified: false` flag downstream UI/policy *could*
  choose to act on. Enforcement, if it exists, lives entirely outside this
  package, opt-in, and easy to never wire up.

### What Sonik adopts vs. deliberately changes

Sonik has no existing package-signing mechanism to compare against; this is
new surface. Payment/webhook signing patterns in the repo (Stripe-adjacent)
are a different trust model (shared-secret HMAC on a per-request payload,
not offline asymmetric signing of a versioned artifact) and not directly
reusable here.

**Adopt:**
- The **payload-construction shape**: hash each meaningful unit of the
  package (for Sonik, likely the canonicalized manifest JSON plus each
  embedded definition, reusing the Item-1 canonicalization) with SHA-256,
  concatenate the digests, append a timestamp, hash-then-sign that buffer
  with RSA-PKCS1v15/SHA-256 (or Ed25519 if the repo already has a signing
  primitive available — check before adding a new crypto dependency; Node's
  built-in `crypto` module covers both without new deps).
  Sonik's manifest is single-JSON rather than multi-file-zip, so the "walk
  files in archive order" step collapses to "hash the canonical manifest
  bytes" — no ordering ambiguity to inherit.
- The **signature-covers-the-metadata-claim** move from step 3: if Sonik
  ever attaches a trust/verification claim (e.g. "published by Sonik,"
  "reviewed," a `proofTier` bump) to a package version, fold that claim's
  hash into the signed buffer the same way dify folds in
  `.verification.dify.json` — so a claim can't be re-attached to a
  different package body after the fact.
- The **multi-key "any trusted key" verification model** if Sonik ever
  supports org-level custom signing keys alongside a platform key — same
  first-match-wins shape as `VerifyPluginWithPublicKeys`.

**Deliberately invert (this is the explicit anti-pattern to avoid, per the
task):**
- **Enforcement must be on by default and structural, not an opt-in config
  struct whose zero value is "off."** Wherever Sonik wires package signing
  into ingest, an invalid or missing signature must **reject the
  package-version write** (or, if unsigned packages are an intentionally
  supported tier, route them to a strictly lower `proofTier` /
  `readiness` value enforced by schema `superRefine`, not by a UI flag that
  can be ignored) rather than merely stamping a `verified: false` field that
  downstream code may or may not check. Concretely: don't add a
  `signatureVerification: { enabled: boolean }` config anywhere in the
  ingest path — if signing exists at all for a given package kind, checking
  it is unconditional for that kind.
- Sonik already has the right instinct for this elsewhere in the schema —
  `marketplaceManifestSchema`'s `superRefine` hard-fails on embedded secrets
  and embedded executable code (`marketplace.ts:520-527`) rather than
  flagging them as metadata. Package-signature enforcement should follow
  that same "reject, don't just annotate" precedent already established in
  this file, not dify's "annotate, let something downstream maybe enforce
  it" precedent.

**Estimated Sonik-side size:** medium-large, mostly because it's new
surface (key management/rotation, deciding which package kinds require
signing, deciding the reject-vs-downgrade policy) rather than because the
crypto is hard — the sign/verify primitives are ~30-40 LOC total using
Node's built-in `crypto`. Payload construction + verification functions:
~80-120 LOC. Ingest-path enforcement wiring (reject on failure, schema-level
`proofTier` gating for unsigned tiers): another 100-150 LOC + tests. Key
storage/rotation is out of scope for the port itself but is the actual
long-pole if this gets built. Rough for the porting scope alone:
**2-3 days**; add more if key-management infrastructure doesn't already
exist.

---

## Per-item verdicts

1. **Content-addressed package identity** — port the hashing algorithm and
   idempotency/anti-spoofing guards into Sonik's existing `manifestHash`
   field; do **not** fold the hash into `packageVersionId` (semver pinning
   there is load-bearing across the schema). Small, ~0.5-1 day.
2. **RPC-boundary per-call permission dispatch** — the check logic
   (`evaluateCapabilityAccess`) already exists and is correct; the gap is
   that nothing calls it at the actual `host-command-runtime.ts` execution
   chokepoint (only at run-start pinning, which has zero live callers
   itself). Port the *wiring discipline* — one unavoidable gate,
   fail-closed on unregistered ids, explicit ban on `() => true`-style
   bypass predicates (dify's upload-file gap is the anti-pattern to not
   repeat). Medium, ~1-2 days.
3. **Offline signature over file-hashes + timestamp** — port the payload-
   construction shape (concatenated per-unit SHA-256 digests + timestamp,
   hash-then-RSA-sign, signature stored as sibling metadata not hashed
   content) and the multi-trusted-key verification model. **Invert** dify's
   central flaw: their verification result is an optional, opt-in-gated,
   never-enforced metadata flag (`Verified: bool`) — a package that fails
   or lacks a signature is fully accepted regardless. Sonik's ingest path
   must reject (or schema-gate to a lower `proofTier`) on signature
   failure by default, following the same reject-don't-annotate precedent
   `marketplace.ts` already sets for secrets/executable-code detection.
   Medium-large, ~2-3 days for the port; key management is separate scope.
