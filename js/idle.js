// Idle clock: counts as active until `limit` ms pass with no mouse/keyboard activity.
export function createIdle(limit = 120000, start = performance.now()) {
  let lastActivity = start;
  return { touch: t => { lastActivity = t; }, active: t => t - lastActivity < limit };
}
