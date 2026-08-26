type Environment = Record<string, string | undefined>;

export type EmailTransportConfig = {
  endpoint: string;
  apiKey: string;
  fromAddress: string;
  fromName: string;
};

export type WhatsappTransportConfig = {
  endpoint: string;
  accessToken: string;
  templateName: string;
  defaultCountryCode: string;
};

function requiredValue(env: Environment, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when the ${name.startsWith("SISPL_EMAIL") ? "email" : "WhatsApp"} transport is enabled.`);
  return value;
}

function assertHttpsEndpoint(raw: string, name: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (endpoint.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(endpoint.hostname)) {
    throw new Error(`${name} may only use http for a local endpoint.`);
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error(`${name} must use the https protocol.`);
  }
  return endpoint.toString();
}

export function emailTransportEnabled(env: Environment) {
  return (env.SISPL_EMAIL_TRANSPORT?.trim().toLowerCase() ?? "log") === "http";
}

export function whatsappTransportEnabled(env: Environment) {
  return (env.SISPL_WHATSAPP_TRANSPORT?.trim().toLowerCase() ?? "off") === "cloud_api";
}

export function readEmailTransportConfig(env: Environment): EmailTransportConfig {
  const fromAddress = requiredValue(env, "SISPL_EMAIL_FROM_ADDRESS");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) throw new Error("SISPL_EMAIL_FROM_ADDRESS must be a valid email address.");
  return {
    endpoint: assertHttpsEndpoint(requiredValue(env, "SISPL_EMAIL_ENDPOINT"), "SISPL_EMAIL_ENDPOINT"),
    apiKey: requiredValue(env, "SISPL_EMAIL_API_KEY"),
    fromAddress,
    fromName: env.SISPL_EMAIL_FROM_NAME?.trim() || "SISPL CA Solution",
  };
}

export function readWhatsappTransportConfig(env: Environment): WhatsappTransportConfig {
  const defaultCountryCode = env.SISPL_WHATSAPP_COUNTRY_CODE?.trim() || "91";
  if (!/^[0-9]{1,4}$/.test(defaultCountryCode)) throw new Error("SISPL_WHATSAPP_COUNTRY_CODE must be a numeric dialling code.");
  const templateName = env.SISPL_WHATSAPP_TEMPLATE?.trim() || "sispl_practice_alert";
  if (!/^[a-z0-9_]{1,64}$/.test(templateName)) throw new Error("SISPL_WHATSAPP_TEMPLATE must be a lowercase template name.");
  return {
    endpoint: assertHttpsEndpoint(requiredValue(env, "SISPL_WHATSAPP_ENDPOINT"), "SISPL_WHATSAPP_ENDPOINT"),
    accessToken: requiredValue(env, "SISPL_WHATSAPP_ACCESS_TOKEN"),
    templateName,
    defaultCountryCode,
  };
}

/** Indian mobile numbers are stored locally; the Cloud API needs full E.164 digits. */
export function toWhatsappRecipient(rawNumber: string, defaultCountryCode: string) {
  const digits = rawNumber.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;
  if (rawNumber.trim().startsWith("+")) return digits.length >= 10 && digits.length <= 15 ? digits : null;
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  if (digits.length > 10 && digits.length <= 15) return digits;
  return null;
}
