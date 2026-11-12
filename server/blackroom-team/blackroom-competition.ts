// STUB: replaced entirely by the builder of this agent. Contract: shared/blackroom-team.ts.
import { underConstructionStatus, type BlackRoomTeamAgentModule } from "@shared/blackroom-team";

const ID = "blackroom-competition" as const;

const agent: BlackRoomTeamAgentModule = {
  id: ID,
  async getStatus() {
    return underConstructionStatus(ID);
  },
  async run() {
    return { ok: false, summary: "Agente en construccion: todavia no ejecuta nada.", error: "not_implemented" };
  },
  actions: {},
};

export default agent;
