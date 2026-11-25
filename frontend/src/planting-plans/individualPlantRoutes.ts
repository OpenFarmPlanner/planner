export function individualPlantGraphicPath(planId: number, locationId: number) {
  const query = new URLSearchParams({ individualPlan: String(planId), locationId: String(locationId) });
  return `/app/fields-beds?${query}`;
}
