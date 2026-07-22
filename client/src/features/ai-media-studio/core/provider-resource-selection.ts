import type { ProviderResource } from "./types";

export function selectableProviderResources(resources: ProviderResource[], selectedId: string) {
  const active = resources.filter((resource) => resource.status === "active");
  return {
    active,
    selectedUnavailable: Boolean(selectedId && !active.some((resource) => resource.id === selectedId)),
  };
}
