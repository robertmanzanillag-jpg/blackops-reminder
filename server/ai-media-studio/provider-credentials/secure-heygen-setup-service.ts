import type { RegisterHeyGenCredentialReferenceResponse } from "../../../shared/ai-media-studio-heygen-secure-setup";
import {
  SecureHeyGenSetupError,
  assertSecureHeyGenSetupRecord,
  prepareSecureHeyGenSetup,
  type SecureHeyGenSetupInput,
  type SecureHeyGenSetupRepository,
} from "./secure-heygen-setup-contracts";

export class SecureHeyGenSetupService {
  constructor(private readonly repository: SecureHeyGenSetupRepository) {}

  async setup(input: SecureHeyGenSetupInput): Promise<RegisterHeyGenCredentialReferenceResponse> {
    const prepared = prepareSecureHeyGenSetup(input);
    let record;
    try {
      record = await this.repository.setup(prepared);
    } catch (error) {
      if (error instanceof SecureHeyGenSetupError) throw error;
      throw new SecureHeyGenSetupError("UNAVAILABLE");
    }
    assertSecureHeyGenSetupRecord(prepared, record);
    return Object.freeze({
      outcome: record.outcome,
      credentialReference: Object.freeze({
        providerKey: "heygen" as const,
        state: "registered" as const,
        credentialVersion: record.credentialVersion,
      }),
    });
  }
}
