// Abort guards for the sweep. Load-bearing: every abort ends the run with no retry
// that day. A "3 consecutive empty results" rule does not work for job search: narrow
// 24h searches are legitimately empty, so the signal here is the canary plus
// LinkedIn's own "no matching jobs" marker. Unknown states fail closed.

export function evaluateSearch(result, { canary, suspectStreak }) {
  switch (result.status) {
    case 'checkpoint': return { abort: 'checkpoint', suspectStreak };
    case 'login': return { abort: 'login-lost', suspectStreak };
    // Dice's firewall (403): no retry that day.
    case 'blocked': return { abort: 'blocked', suspectStreak };
    case 'ok': return { abort: null, suspectStreak: 0 };
    case 'empty': return canary ? { abort: 'canary-empty', suspectStreak } : { abort: null, suspectStreak: 0 };
    case 'suspect':
      if (canary) return { abort: 'canary-failed', suspectStreak: suspectStreak + 1 };
      return suspectStreak + 1 >= 2 ? { abort: 'throttle-suspect', suspectStreak: suspectStreak + 1 } : { abort: null, suspectStreak: suspectStreak + 1 };
    default: return { abort: `unknown-status:${result.status}`, suspectStreak };
  }
}

export function evaluateView(result, { unreadableStreak }) {
  switch (result.status) {
    case 'checkpoint': return { abort: 'checkpoint', unreadableStreak };
    case 'login': return { abort: 'login-lost', unreadableStreak };
    case 'blocked': return { abort: 'blocked', unreadableStreak };
    case 'ok': return { abort: null, unreadableStreak: 0 };
    case 'unreadable':
      return unreadableStreak + 1 >= 2 ? { abort: 'views-unreadable', unreadableStreak: unreadableStreak + 1 } : { abort: null, unreadableStreak: unreadableStreak + 1 };
    default: return { abort: `unknown-status:${result.status}`, unreadableStreak };
  }
}
