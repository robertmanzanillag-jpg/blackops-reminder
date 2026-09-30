export function validSnapshot(data) {
  const keys = ['projectCount','collectiveCount','radioCount','labelCount','otherProjectCount','extraTypeAssignments','candidateCount','corroboratedCount','djCount'];
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!data || data.version !== 1 || data.mode !== 'snapshot' || !date(data.capturedAt)) return false;
  if (data.lastActivityAt !== null && !date(data.lastActivityAt)) return false;
  const c = data.counts;
  if (keys.some(key => !Number.isSafeInteger(c?.[key]) || c[key] < 0)) return false;
  return c.corroboratedCount <= c.projectCount && c.collectiveCount + c.radioCount + c.labelCount - c.extraTypeAssignments + c.otherProjectCount === c.projectCount;
}
