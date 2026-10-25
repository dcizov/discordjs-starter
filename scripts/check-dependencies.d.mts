/**
 * Types for the plain-JavaScript dependency guard, so the tests that exercise
 * it are typechecked together with the rest of the repository.
 */
export type DependencyProbe = {
  /** Resolves a package id; throw (or return falsy) when it is missing. */
  resolve: (id: string) => unknown;
  /** Package names the caller believes are installed; defaults to the required list. */
  list?: readonly string[];
};

/** Packages whose absence breaks a build or a service at startup. */
export declare const REQUIRED_DEPENDENCIES: readonly string[];
/** Remediation text printed by the CLI; never contains environment values. */
export declare const REMEDIATION: string;
export declare function checkDependencies(probe?: DependencyProbe): {
  missing: string[];
};
