import type {
  ConsumeOAuthSession,
  CreateOAuthSession,
  OAuthSession,
  OAuthSessionRepository,
} from "./contracts";

function clone(session: OAuthSession): OAuthSession {
  return { ...session, scope: { ...session.scope }, requestedScopes: [...session.requestedScopes] };
}

export class InMemoryOAuthSessionRepository implements OAuthSessionRepository {
  private readonly sessions = new Map<string, OAuthSession>();

  async create(input: CreateOAuthSession): Promise<OAuthSession> {
    if ([...this.sessions.values()].some((session) => session.stateDigest === input.stateDigest)) {
      throw new Error("OAuth state digest already exists");
    }
    const session: OAuthSession = {
      ...input,
      scope: { ...input.scope },
      requestedScopes: [...input.requestedScopes],
      status: "pending",
      outcome: null,
      consumedAt: null,
      updatedAt: input.createdAt,
    };
    this.sessions.set(session.id, session);
    return clone(session);
  }

  async consume(input: ConsumeOAuthSession): Promise<OAuthSession | undefined> {
    const session = [...this.sessions.values()].find((candidate) => candidate.stateDigest === input.stateDigest);
    if (!session || session.status !== "pending" || Date.parse(session.expiresAt) <= Date.parse(input.now)) return undefined;
    if (session.platform !== input.platform) return undefined;
    const consumed: OAuthSession = {
      ...session,
      status: "consumed",
      outcome: input.outcome,
      consumedAt: input.now,
      updatedAt: input.now,
    };
    this.sessions.set(consumed.id, consumed);
    return clone(consumed);
  }
}
