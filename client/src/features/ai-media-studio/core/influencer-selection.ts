export type GenerationInfluencerOption = {
  id: string;
  status: string;
  language: string;
  voiceId: string;
};

export function eligibleGenerationInfluencers<T extends GenerationInfluencerOption>(influencers: readonly T[]): T[] {
  return influencers.filter((influencer) => influencer.status === "active" || influencer.status === "ready");
}

export function reconcileGenerationInfluencer<T extends GenerationInfluencerOption>(influencers: readonly T[], currentId: string): T | undefined {
  const eligible = eligibleGenerationInfluencers(influencers);
  return eligible.find((influencer) => influencer.id === currentId) ?? eligible[0];
}
