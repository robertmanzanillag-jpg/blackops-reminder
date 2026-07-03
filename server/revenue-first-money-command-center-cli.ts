import { getRevenueEngineSnapshot } from "./revenue-engine";

type FirstMoneyCommandStatus = "ready" | "blocked" | "review";

type FirstMoneyCommandQueueItem = {
  id: string;
  label: string;
  command: string;
  status: FirstMoneyCommandStatus;
  reason: string;
};

const FIRST_MONEY_QUEUE_PRIORITY = [
  "candidate-review",
  "website-sales-packet",
  "outreach-review",
  "website-close",
  "website-handoff",
  "public-scout",
  "readiness",
];

function sortFirstMoneyQueue(queue: FirstMoneyCommandQueueItem[]) {
  return queue.slice().sort((left, right) => FIRST_MONEY_QUEUE_PRIORITY.indexOf(left.id) - FIRST_MONEY_QUEUE_PRIORITY.indexOf(right.id));
}

export function buildRevenueFirstMoneyCommandCenter(options: { mode: "first-sprint" | "production-launch"; json: boolean }) {
  const snapshot = getRevenueEngineSnapshot();
  const publicLeadQueue = snapshot.publicLeadImportQueue;
  const websiteSalesPacketQueue = snapshot.websiteSalesPacketQueue;
  const outreachQueue = snapshot.manualOutreachQueue;
  const websiteClosureQueue = snapshot.websiteClosureQueue;
  const websiteQueue = snapshot.websiteDeliveryHandoffQueue;
  const publicCandidates = snapshot.recentPublicLeadCandidates || [];
  const outreachDrafts = (snapshot.recentOutreach || []).filter((draft) => draft.delivery.sendStatus !== "sent");
  const approvedOutreachDrafts = outreachDrafts.filter((draft) => draft.status === "approved");
  const remainingGaps = [
    ...snapshot.moneyActivationPlan.blockedUntilApproved,
    ...snapshot.moneyActivationPlan.missingBeforeRealMoney.map((item) => item.label),
  ];
  const publicCandidateIds = publicLeadQueue.items.map((item) => item.candidateId).slice(0, 5).join(",");
  const nextSalesPacket = websiteSalesPacketQueue.items[0] || null;
  const nextOutreachDraftId = outreachQueue.items[0]?.draftId || "OUTREACH_ID";
  const nextClosure = websiteClosureQueue.items[0] || null;
  const nextWebsiteDraftId = websiteQueue.items[0]?.outreachDraftId || nextOutreachDraftId;
  const queue: FirstMoneyCommandQueueItem[] = [
    {
      id: "readiness",
      label: "Confirm first-money gates",
      command: "Open Revenue Engine and review Money Activation + Profit Guard.",
      status: snapshot.moneyActivationPlan.canStartToday ? "ready" : "blocked",
      reason: snapshot.moneyActivationPlan.canStartToday
        ? "Confirms what can run today without unsafe spend/contact/deploy."
        : remainingGaps[0] || "First-money gates are blocked.",
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
        command: snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief || "Use guarded public scout evidence capture in Revenue Engine.",
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
    websiteSalesPacketQueue.readyCount > 0
      ? {
        id: "website-sales-packet",
        label: "Prepare website sales packet",
        command: nextSalesPacket?.copyableSalesPacket || "Copy the website sales packet from Revenue Engine before creating an opportunity.",
        status: "review",
        reason: `${websiteSalesPacketQueue.readyCount} website sales packet(s) have mockup, offer and close plan ready.`,
      }
      : {
        id: "website-sales-packet",
        label: "Prepare website sales packet",
        command: "Generate a Money Sprint lead with mockup and draft before packaging the website sale.",
        status: "blocked",
        reason: websiteSalesPacketQueue.nextAction || "No website sales packet is ready yet.",
      },
    websiteClosureQueue.readyCount > 0
      ? {
        id: "website-close",
        label: "Close deposit and scope",
        command: nextClosure?.copyableClosurePacket || "Collect deposit proof and scope approval before website build.",
        status: "review",
        reason: `${websiteClosureQueue.readyCount} website opportunit${websiteClosureQueue.readyCount === 1 ? "y needs" : "ies need"} deposit/scope evidence before build.`,
      }
      : {
        id: "website-close",
        label: "Close deposit and scope",
        command: "Create an approved website opportunity before collecting deposit/scope evidence.",
        status: "blocked",
        reason: websiteClosureQueue.nextAction || "No quoted website opportunity is waiting for close evidence.",
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
  const sortedQueue = sortFirstMoneyQueue(queue);
  const funnelQueue = sortedQueue.filter((item) => item.id !== "readiness");
  const nextCommand =
    funnelQueue.find((item) => item.status === "review") ||
    funnelQueue.find((item) => item.status === "ready") ||
    queue[0];

  return {
    status: snapshot.moneyActivationPlan.canStartToday ? "ready_for_first_money_work" as const : "blocked" as const,
    mode: options.mode,
    nextCommand,
    queue: sortedQueue,
    counts: {
      publicCandidates: publicCandidates.length,
      reviewablePublicCandidates: publicLeadQueue.readyCount + publicLeadQueue.blockedCount,
      importReadyCandidates: publicLeadQueue.readyCount,
      leads: snapshot.recentLeads.length,
      websiteSalesPackets: websiteSalesPacketQueue.readyCount,
      outreachDrafts: outreachDrafts.length,
      reviewableOutreachDrafts: outreachQueue.readyCount,
      websiteClosures: websiteClosureQueue.readyCount,
      websiteHandoffs: websiteQueue.readyCount,
      approvedOutreachDrafts: approvedOutreachDrafts.length,
    },
    readiness: {
      canSearchBusinesses: snapshot.moneyActivationPlan.canStartToday,
      canContactBusinesses: snapshot.moneyActivationPlan.canContactBusinesses,
      canCollectMoney: snapshot.moneyActivationPlan.canCollectMoney,
      canBuildWebsites: snapshot.moneyActivationPlan.canBuildWebsites,
      remainingGaps,
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
