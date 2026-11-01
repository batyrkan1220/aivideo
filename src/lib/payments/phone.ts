/** "8 700 123 45 67", "+7 (700) 123-45-67", "7001234567" → "+77001234567"; null if not a KZ mobile number. */
export function normalizeKzPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && (d[0] === "7" || d[0] === "8") ? d.slice(1) : d.length === 10 ? d : null;
  return ten && ten[0] === "7" ? `+7${ten}` : null;
}

/** The 10 national digits of whatever was typed or pasted ("+7 701…", "8701…", "701…"). */
export function kzNationalDigits(raw: string): string {
  const t = raw.trim();
  let d = (t.startsWith("+7") ? t.slice(2) : t).replace(/\D/g, "");
  if (d[0] === "8") d = d.slice(1); // trunk prefix: national mobile numbers start with 7
  if (d.length >= 11 && d[0] === "7") d = d.slice(1); // pasted with the country code
  return d.slice(0, 10);
}

/** Display mask for the national part: "701 555 12 34". */
export function maskKzNational(n: string): string {
  return [n.slice(0, 3), n.slice(3, 6), n.slice(6, 8), n.slice(8, 10)].filter(Boolean).join(" ");
}
