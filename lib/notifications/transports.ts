import {
  emailTransportEnabled,
  readEmailTransportConfig,
  readWhatsappTransportConfig,
  toWhatsappRecipient,
  whatsappTransportEnabled,
  type EmailTransportConfig,
  type WhatsappTransportConfig,
} from "./config";
import { logEmailTransport, type NotificationTransport, type OutboundNotification } from "./dispatch";

type Environment = Record<string, string | undefined>;

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/** Never let a provider's error body leak a token or a full recipient address. */
function safeFailure(status: number, body: string) {
  return new TransportError(`Provider responded ${status}: ${body.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 200)}`);
}

export function renderPlainTextBody(message: OutboundNotification) {
  return `${message.title}\n\n${message.body}\n\n— ${message.tenantName ?? "SISPL CA Solution"}`;
}

export function renderHtmlBody(message: OutboundNotification) {
  const escape = (value: string) => value
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#101828">`
    + `<p style="margin:0 0 12px"><strong>${escape(message.title)}</strong></p>`
    + (message.body ? `<p style="margin:0 0 16px;color:#475467">${escape(message.body)}</p>` : "")
    + `<p style="margin:0;font-size:13px;color:#667085">Sent by ${escape(message.tenantName ?? "SISPL CA Solution")}. Sign in to the practice workspace for details.</p>`
    + `</div>`;
}

export function createHttpEmailTransport(config: EmailTransportConfig): NotificationTransport {
  return {
    channel: "email",
    async send(message) {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${config.fromName} <${config.fromAddress}>`,
          to: [message.recipientEmail],
          subject: message.title,
          text: renderPlainTextBody(message),
          html: renderHtmlBody(message),
        }),
      });
      if (!response.ok) throw safeFailure(response.status, await response.text().catch(() => ""));
    },
  };
}

export function createWhatsappTransport(config: WhatsappTransportConfig): NotificationTransport {
  return {
    channel: "whatsapp",
    async send(message) {
      const recipient = message.recipientPhone ? toWhatsappRecipient(message.recipientPhone, config.defaultCountryCode) : null;
      if (!recipient) throw new TransportError("The recipient has no usable mobile number on their employee profile.");
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: config.templateName,
            language: { code: "en" },
            components: [{ type: "body", parameters: [{ type: "text", text: message.title }, { type: "text", text: message.body || "—" }] }],
          },
        }),
      });
      if (!response.ok) throw safeFailure(response.status, await response.text().catch(() => ""));
    },
  };
}

/**
 * Builds the transports the current environment actually authorises. The log
 * transport stays the default so a misconfigured deployment degrades to
 * "recorded but not delivered" rather than silently dropping alerts.
 */
export function resolveNotificationTransports(env: Environment = process.env): NotificationTransport[] {
  const transports: NotificationTransport[] = [];
  transports.push(emailTransportEnabled(env) ? createHttpEmailTransport(readEmailTransportConfig(env)) : logEmailTransport);
  if (whatsappTransportEnabled(env)) transports.push(createWhatsappTransport(readWhatsappTransportConfig(env)));
  return transports;
}

export function describeTransports(env: Environment = process.env) {
  return {
    email: emailTransportEnabled(env) ? "http" : "log",
    whatsapp: whatsappTransportEnabled(env) ? "cloud_api" : "off",
  };
}
