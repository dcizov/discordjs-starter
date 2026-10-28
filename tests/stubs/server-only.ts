/**
 * Stub for the `server-only` package.
 *
 * Next ships `server-only` as a build-time guard: importing it from a module
 * that reaches a client bundle is what fails the build. It is not installed as
 * a dependency here, so Vitest cannot resolve it at all, and any test that
 * imports app code touching it dies with "Cannot find package" before a single
 * test runs.
 *
 * Seven test files each mocked it by hand, which held until a sixth module
 * (`lib/member-wire.ts`) started using it — then four route tests broke at
 * once, none of them related to the change. Aliasing it once here means the
 * guard keeps its job in the real build and stops being a landmine in tests.
 *
 * It is a no-op on purpose: the protection it provides is applied by the
 * bundler, not at runtime, so there is nothing to emulate.
 */
export {};
