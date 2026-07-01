function sanitizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function domainFromEmail(email: string) {
  const normalized = sanitizeEmail(email);
  const at = normalized.indexOf("@");
  if (at < 0) return "";
  return normalized.slice(at + 1);
}

export function isSameDomainEmail(a: string, b: string) {
  const domainA = domainFromEmail(a);
  const domainB = domainFromEmail(b);
  return Boolean(domainA) && domainA === domainB;
}

export function maskEmail(email: string) {
  const normalized = sanitizeEmail(email);
  const [name, domain] = normalized.split("@");
  if (!domain || !name) return "hidden";
  if (name.length <= 2) return `${name[0] || "*"}*@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

export function maskUpiId(upiId: string) {
  const trimmed = upiId.trim();
  if (!trimmed) return "hidden";
  const [name, provider] = trimmed.split("@");
  if (!provider || !name) return "hidden";
  const visible = name.length <= 2 ? name : `${name.slice(0, 2)}***`;
  return `${visible}@${provider}`;
}
