// Small formatting helpers used across the CRUD pages.

export function formatCoords(lat: unknown, lon: unknown): string {
  if (lat == null || lon == null) return "—";
  return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

const DT_FMT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: unknown): string {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DT_FMT.format(d);
}

/** Render an audit line: "Apr 12, 14:23 by Alice". */
export function formatAudit(
  at: unknown,
  by: { displayName?: string | null; preferredUsername?: string | null; email?: string | null } | null | undefined
): string {
  const when = formatDateTime(at);
  const who =
    by?.displayName?.trim() ||
    by?.preferredUsername?.trim() ||
    by?.email?.trim() ||
    "";
  return who ? `${when} by ${who}` : when;
}

/** Hz → "433.5 MHz" / "144.800 MHz" / "1090 MHz" — choose a reasonable unit. */
export function formatFrequencyHz(hz: unknown): string {
  if (hz == null) return "—";
  const n = Number(hz);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(3).replace(/\.?0+$/, "")} GHz`;
  if (n >= 1_000_000)      return `${(n / 1_000_000).toFixed(6).replace(/\.?0+$/, "")} MHz`;
  if (n >= 1_000)          return `${(n / 1_000).toFixed(3).replace(/\.?0+$/, "")} kHz`;
  return `${n} Hz`;
}

/** Hz bandwidth → "12.5 kHz" / "200 kHz" / "1.0 MHz" */
export function formatBandwidthHz(hz: unknown): string {
  if (hz == null) return "—";
  const n = Number(hz);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(3).replace(/\.?0+$/, "")} MHz`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(3).replace(/\.?0+$/, "")} kHz`;
  return `${n} Hz`;
}
