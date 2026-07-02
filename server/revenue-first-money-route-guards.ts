export type RevenueFirstMoneyCandidateRouteBatch = {
  id: string;
  area: string;
  niche: string;
  offerFocus: string;
  approvalDecisionId: string;
  confirmationText: string;
  candidateIds: string[];
};

export type RevenueFirstMoneyCandidateRouteInput = Omit<RevenueFirstMoneyCandidateRouteBatch, "id"> & {
  batchId: string;
};

export function revenueCandidateIdsMatch(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((candidateId, index) => candidateId === sortedRight[index]);
}

export function matchesRevenueFirstMoneyApprovedCandidateBatch(
  input: RevenueFirstMoneyCandidateRouteInput,
  batch: RevenueFirstMoneyCandidateRouteBatch | undefined,
) {
  return Boolean(
    batch
    && input.batchId === batch.id
    && input.area === batch.area
    && input.niche === batch.niche
    && input.offerFocus === batch.offerFocus
    && input.approvalDecisionId === batch.approvalDecisionId
    && input.confirmationText === batch.confirmationText
    && revenueCandidateIdsMatch(input.candidateIds, batch.candidateIds),
  );
}
