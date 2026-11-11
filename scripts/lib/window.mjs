// f_TPR window: seconds since the last successful sweep plus a buffer, so nothing
// posted between sweeps is missed. First run (or unreadable state) backfills.
export function tprSeconds(lastSuccessIso, nowMs, { first_run_seconds, buffer_hours, cap_seconds }) {
  const last = lastSuccessIso ? Date.parse(lastSuccessIso) : NaN;
  if (Number.isNaN(last)) return first_run_seconds;
  const since = Math.max(0, Math.round((nowMs - last) / 1000));
  return Math.min(cap_seconds, since + buffer_hours * 3600);
}
