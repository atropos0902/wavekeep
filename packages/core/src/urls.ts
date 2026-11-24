const TRACKING = /^(?:utm_[a-z]+|gclid|fbclid|msclkid|srsltid|mc_[a-z]+|igshid|_hs[a-z]+|ref_src|trk)$/i;

export interface CleanUrl {
  url: string;
  host: string;
}

/** Returns null for anything that isn't http or https. */
export function cleanUrl(raw: string): CleanUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.username = "";
  u.password = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  const host = u.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  const path = u.pathname.replace(/\/+$/, "");
  const query = u.searchParams.toString();
  const port = u.port ? `:${u.port}` : "";
  return { url: `https://${host}${port}${path}${query ? `?${query}` : ""}`, host };
}

/** True for the domain itself and its subdomains, never for a lookalike. */
export const hostBelongsTo = (host: string, domain: string): boolean => {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host === d || host.endsWith(`.${d}`);
};
