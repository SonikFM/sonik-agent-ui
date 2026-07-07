export const sonikCommandRegistryArtifactVersion =
  "sonik-agent-ui.global-command-registry.v1" as const;
export const sonikCommandRegistryProvider = "sonik-global-command-registry" as const;
export const sonikBookingCommandProvider = "sonik-booking-openapi-fixture" as const;
export const sonikCommandRegistryGeneratedDocPath =
  "docs/sonik-command-registry.generated.json" as const;

export type SonikCommandRegistryArtifactVersion = typeof sonikCommandRegistryArtifactVersion;
export type SonikCommandRegistryProvider = typeof sonikCommandRegistryProvider;
export type SonikBookingCommandProvider = typeof sonikBookingCommandProvider;
