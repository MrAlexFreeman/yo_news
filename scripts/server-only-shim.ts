/**
 * Makes `server-only` importable from a plain Node test process.
 *
 * The package exists to fail a build when a server module reaches the browser: it
 * throws on import outside a server bundle. That guard is real and worth keeping, and
 * this shim does not weaken it — it only neutralises the throw inside a test process
 * that already ran under tsx and has no browser bundle to leak into.
 *
 * Why it is needed at all: `dzen:check` imports `createArticleAction` directly,
 * because a FormData POST to a page URL never reaches a Server Action, so an
 * HTTP-level test would pass while checking nothing. That action imports
 * `@/lib/vk-video`, which imports `server-only`, and the run died before its first
 * assertion.
 *
 * Removing the guard line from `vk-video.ts` was considered and rejected: the same
 * module imports `@/lib/settings`, which carries the identical guard, so the
 * transitive import would throw anyway. Only the runtime shim actually fixes it.
 *
 * `require.cache` is filled before the module graph is loaded, which is why callers
 * must reach the module under test through a dynamic `import()` — a static one is
 * hoisted and would run first.
 */
export function stubServerOnly(): void {
  const entry = require.resolve("server-only");

  require.cache[entry] = {
    id: entry,
    filename: entry,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeModule;
}