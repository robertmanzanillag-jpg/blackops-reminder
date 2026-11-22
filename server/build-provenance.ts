/** Build identity, not remote attestation or evidence of worker execution. */
export type BuildProvenance = {
  version: 1;
  status: "verified" | "unverified";
  revision: string | null;
  trackedClean: boolean;
  runtimeSourceSha256: string | null;
  runtimeSourceFiles: number;
  scope: "tracked-runtime-source-v1";
  reason: "clean_build" | "unstamped" | "git_unavailable" | "tracked_dirty" | "source_unavailable";
};

declare const __BLACKOPS_BUILD_PROVENANCE__: BuildProvenance;

export function unverifiedBuildProvenance(reason: BuildProvenance["reason"] = "unstamped"): BuildProvenance {
  return { version: 1, status: "unverified", revision: null, trackedClean: false,
    runtimeSourceSha256: null, runtimeSourceFiles: 0, scope: "tracked-runtime-source-v1", reason };
}

// esbuild substitutes a literal. No environment, filesystem or Git reads at runtime.
export function buildProvenance(): Readonly<BuildProvenance> {
  return Object.freeze(typeof __BLACKOPS_BUILD_PROVENANCE__ === "undefined"
    ? unverifiedBuildProvenance() : { ...__BLACKOPS_BUILD_PROVENANCE__ });
}
