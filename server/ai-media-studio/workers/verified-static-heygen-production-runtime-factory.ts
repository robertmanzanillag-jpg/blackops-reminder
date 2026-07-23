import {
  createStaticHeyGenSecretResolver,
  type StaticHeyGenSecretResolverOptions,
} from "../provider-credentials/static-heygen-secret-resolver";
import {
  DrizzleAdmittedProviderArtifactBindingLoader,
  type AdmittedProviderArtifactBindingDatabase,
} from "../assets/drizzle-admitted-artifact-binding-loader";
import {
  DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader,
  VerifiedStaticHeyGenRuntimeCredentialMaterializer,
  type VerifiedStaticHeyGenRuntimeCredentialDatabase,
} from "../provider-credentials/verified-static-heygen-runtime-credential";
import {
  createProductionAdmittedRenderRuntime,
  type CreateProductionAdmittedRenderRuntimeInput,
  type ProductionAdmittedRenderRuntime,
} from "./production-admitted-render-runtime";

type InertRuntimeDependencies = Omit<
  CreateProductionAdmittedRenderRuntimeInput,
  "heyGen" | "heyGenCredentialMaterializer" | "resolveArtifactBinding" | "assetHooks"
>;

export interface VerifiedStaticHeyGenProductionRuntimeFactoryInput {
  readonly runtime: InertRuntimeDependencies;
  readonly credentialDatabase: VerifiedStaticHeyGenRuntimeCredentialDatabase;
  readonly artifactBindingDatabase: AdmittedProviderArtifactBindingDatabase;
  readonly secretResolverOptions?: StaticHeyGenSecretResolverOptions;
}

/**
 * Builds the server-only production runtime seam. Creating this factory and
 * invoking it are inert: database and deployment-secret reads remain deferred
 * until a worker resolves already-admitted work.
 */
export function createVerifiedStaticHeyGenProductionRuntimeFactory(
  input: VerifiedStaticHeyGenProductionRuntimeFactoryInput,
): (runtimeInput: Readonly<{
  assetHooks: NonNullable<CreateProductionAdmittedRenderRuntimeInput["assetHooks"]>;
}>) => ProductionAdmittedRenderRuntime {
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader(input.credentialDatabase);
  const artifactBindingLoader = new DrizzleAdmittedProviderArtifactBindingLoader(
    input.artifactBindingDatabase,
  );
  const secretResolver = createStaticHeyGenSecretResolver(input.secretResolverOptions);
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, secretResolver);
  return (runtimeInput) => createProductionAdmittedRenderRuntime({
    ...input.runtime,
    assetHooks: runtimeInput.assetHooks,
    heyGenCredentialMaterializer: materializer,
    async resolveArtifactBinding(request) {
      const binding = await artifactBindingLoader.load(request);
      if (!binding || binding.providerKey !== "heygen") {
        throw new Error("Verified HeyGen artifact binding unavailable");
      }
      return { ...binding, providerKey: "heygen" as const };
    },
  } as CreateProductionAdmittedRenderRuntimeInput);
}
