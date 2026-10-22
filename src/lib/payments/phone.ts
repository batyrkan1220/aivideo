/** "8 700 123 45 67", "+7 (700) 123-45-67", "7001234567" → "+77001234567"; null if not a KZ mobile number. */
export function normalizeKzPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && (d[0] === "7" || d[0] === "8") ? d.slice(1) : d.length === 10 ? d : null;
  return ten && ten[0] === "7" ? `+7${ten}` : null;
}
