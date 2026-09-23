export function timeAgo(ts: number | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return diff >= 0 ? "just now" : "in a moment";
  const value =
    abs < hour
      ? Math.round(abs / minute)
      : abs < day
        ? Math.round(abs / hour)
        : Math.round(abs / day);
  const unit = abs < hour ? "min" : abs < day ? "h" : "d";
  const suffix = diff >= 0 ? "ago" : "from now";
  const label =
    unit === "min"
      ? `${value} min ${suffix}`
      : `${value}${unit === "h" ? "h" : "d"} ${suffix}`;
  return label;
}

export function formatDate(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function domainOf(website: string | undefined): string {
  if (!website) return "";
  return website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}
