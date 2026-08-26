const MONEY_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/;

export function parseMoneyToPaise(raw: string) {
  const normalized = raw.trim().replaceAll(",", "");
  if (!MONEY_PATTERN.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

export function formatPaise(paise: number) {
  if (!Number.isSafeInteger(paise)) throw new Error("Money must be stored as integer paise.");
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
}
