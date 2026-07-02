import { getRevenueEngineSnapshot } from "./revenue-engine";

type FirstMoneyCommandStatus = "ready" | "blocked" | "review";

type FirstMoneyCommandQueueItem = {
  id: string;
  label: string;
  command: string;
  status: FirstMoneyCommandStatus;
  reason: string;
};

export function buildRevenueFirstMoneyCommandCenter(options: { mode: "first-sprint" | "production-launch"; json: boolean }) {
  const snapshot = getRevenueEngineSnapshot();
  const publicLeadQueue = snapshot.publicLeadImportQueue;
  const outreachQueue = snapshot.manualOutreachQueue;
  const websiteQueue = snapshot.websiteDeliveryHandoffQueue;
  const publicCandidates = snapshot.recentPublicLeadCandidates || [];
  const outreachDrafts = (snapshot.recentOutreach || []).filter((draft) => draft.delivery.sendStatus !== "sent");
  const approvedOutreachDrafts = outreachDrafts.filter((draft) => draft.status === "approved");
  const publicCandidateIds = publicLeadQueue.items.map((item) => item.candidateId).slice(0, 5).join(",");
  const nextOutreachDraftId = outreachQueue.items[0]?.outreachDraftId || "OUTREACH_ID";
  const nextWebsiteDraftId = websiteQueue.items[0]?.outreachDraftId || nextOutreachDraftId;
  const queue: FirstMoneyCommandQueueItem[] = [
    {
      id: "readiness",
      label: "Confirm first-money gates",
      command: "Open Revenue Engine and review Money Activation + Profit Guard.",
      status: snapshot.moneyActivationPlan.canStartToday ? "ready" : "blocked",
      reason: snapshot.moneyActivationPlan.canStartToday
        ? "Confirms what can run today without unsafe spend/contact/deploy."
        : snapshot.moneyActivationPlan.blockedUntil[0] || "First-money gates are blocked.",
    },
    publicLeadQueue.readyCount > 0
      ? {
        id: "candidate-review",
        label: "Review captured public candidates",
        command: `Run Money Sprint from verified candidate ids: ${publicCandidateIds || "READY_CANDIDATE_IDS"}`,
        status: "review",
        reason: `${publicLeadQueue.readyCount} verified public candidate(s) are ready for Robert-reviewed import.`,
      }
      : {
        id: "public-scout",
        label: "Find businesses",
        command: snapshot.businessScoutQueue.copyableBrief || "Use guarded public scout evidence capture in Revenue Engine.",
        status: snapshot.moneyActivationPlan.canStartToday ? "ready" : "blocked",
        reason: publicLeadQueue.nextAction || "Start guarded public scouting before contact, spend, or website work.",
      },
    outreachQueue.readyCount > 0
      ? {
        id: "outreach-review",
        label: "Review outreach drafts",
        command: `Review manual outreach draft ${nextOutreachDraftId}; do not send without Robert approval.`,
        status: "review",
        reason: `${outreachQueue.readyCount} draft(s) need manual review before any external contact.`,
      }
      : {
        id: "outreach-review",
        label: "Review outreach drafts",
        command: "Create draft-only outreach after a reviewed Money Sprint.",
        status: "blocked",
        reason: "No draft is ready for outreach review.",
      },
    websiteQueue.readyCount > 0
      ? {
        id: "website-handoff",
        label: "Prepare paid website handoff",
        command: `Prepare website delivery handoff from approved draft ${nextWebsiteDraftId}.`,
        status: "review",
        reason: `${websiteQueue.readyCount} paid website handoff(s) have deposit/scope evidence ready for guarded delivery.`,
      }
      : {
        id: "website-handoff",
        label: "Prepare paid website handoff",
        command: "Collect deposit, scope approval, and public data evidence before website delivery.",
        status: "blocked",
        reason: "No approved paid website handoff exists yet.",
      },
  ];
  const funnelQueue = queue.filter((item) => item.id !== "readiness");
  const nextCommand =
    funnelQueue.find((item) => item.status === "review") ||
    funnelQueue.find((item) => item.status === "ready") ||
    queue[0];

  return {
    status: snapshot.moneyActivationPlan.canStartToday ? "ready_for_first_money_work" as const : "blocked" as const,
    mode: options.mode,
    nextCommand,
    queue,
    counts: {
      publicCandidates: publicCandidates.length,
      reviewablePublicCandidates: publicLeadQueue.readyCount + publicLeadQueue.blockedCount,
      importReadyCandidates: publicLeadQueue.readyCount,
      leads: snapshot.recentLeads.length,
      outreachDrafts: outreachDrafts.length,
      reviewableOutreachDrafts: outreachQueue.readyCount,
      approvedOutreachDrafts: approvedOutreachDrafts.length,
    },
    readiness: {
      canSearchBusinesses: snapshot.moneyActivationPlan.canStartToday,
      canContactBusinesses: snapshot.moneyActivationPlan.canContactBusinesses,
      canCollectMoney: snapshot.moneyActivationPlan.canCollectMoney,
      canBuildWebsites: snapshot.moneyActivationPlan.canBuildWebsites,
      remainingGaps: snapshot.moneyActivationPlan.blockedUntil,
    },
    safety: {
      writesFiles: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      printsSecrets: false,
    },
  };
}
