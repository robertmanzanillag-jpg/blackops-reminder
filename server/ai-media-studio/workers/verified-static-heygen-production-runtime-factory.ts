import {
  createStaticHeyGenSecretResolver,
  type StaticHeyGenSecretResolverOptions,
} from "../provider-credentials/static-heygen-secret-resolver";
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
  "heyGen" | "heyGenCredentialMaterializer"
>;

export interface VerifiedStaticHeyGenProductionRuntimeFactoryInput {
  readonly runtime: InertRuntimeDependencies;
  readonly credentialDatabase: VerifiedStaticHeyGenRuntimeCredentialDatabase;
  readonly secretResolverOptions?: StaticHeyGenSecretResolverOptions;
}

/**
 * Builds the server-only production runtime seam. Creating this factory and
 * invoking it are inert: database and deployment-secret reads remain deferred
 * until a worker resolves already-admitted work.
 */
export function createVerifiedStaticHeyGenProductionRuntimeFactory(
  input: VerifiedStaticHeyGenProductionRuntimeFactoryInput,
): () => ProductionAdmittedRenderRuntime {
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader(input.credentialDatabase);
  const secretResolver = createStaticHeyGenSecretResolver(input.secretResolverOptions);
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, secretResolver);
  return () => createProductionAdmittedRenderRuntime({
    ...input.runtime,
    heyGenCredentialMaterializer: materializer,
  } as CreateProductionAdmittedRenderRuntimeInput);
}
