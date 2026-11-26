export function individualPlantGraphicPath(planId: number, locationId: number, edit = false) {
  const query = new URLSearchParams({ individualPlan: String(planId), locationId: String(locationId) });
  if (edit) query.set('editIndividualPlan', 'true');
  return `/app/fields-beds?${query}`;
}
