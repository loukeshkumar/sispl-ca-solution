import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";

import {
  emailTransportEnabled,
  readEmailTransportConfig,
  readWhatsappTransportConfig,
  toWhatsappRecipient,
  whatsappTransportEnabled,
} from "../lib/notifications/config";
import {
  createHttpEmailTransport,
  createWhatsappTransport,
  describeTransports,
  renderHtmlBody,
  renderPlainTextBody,
  resolveNotificationTransports,
} from "../lib/notifications/transports";
import type { OutboundNotification } from "../lib/notifications/dispatch";

const message: OutboundNotification = {
  channel: "email",
  recipientEmail: "nisha@example.invalid",
  recipientName: "Nisha S.",
  recipientPhone: "98765 43210",
  tenantName: "Sharma & Kumar",
  title: "GSTR 3B for Aarav Retail is overdue",
  body: "Statutory due date 2026-08-20.",
};

const received: Array<{ url: string; auth: string; body: unknown }> = [];
let server: Server;
let port = 0;

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      received.push({ url: request.url ?? "", auth: request.headers.authorization ?? "", body: raw ? JSON.parse(raw) : null });
      if ((request.url ?? "").includes("fail")) {
        response.writeHead(422, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "token dummy_token_abcdefghijklmnopqrstuvwx rejected" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("transports default to log-only so a bare environment never silently drops alerts", () => {
  assert.equal(emailTransportEnabled({}), false);
  assert.equal(whatsappTransportEnabled({}), false);
  assert.deepEqual(describeTransports({}), { email: "log", whatsapp: "off" });
  const transports = resolveNotificationTransports({});
  assert.equal(transports.length, 1);
  assert.equal(transports[0].channel, "email");
});

test("email transport configuration requires every credential and refuses plaintext http off-localhost", () => {
  const base = {
    SISPL_EMAIL_TRANSPORT: "http",
    SISPL_EMAIL_ENDPOINT: "https://api.example.com/emails",
    SISPL_EMAIL_API_KEY: "key",
    SISPL_EMAIL_FROM_ADDRESS: "alerts@firm.example",
  };
  assert.equal(readEmailTransportConfig(base).fromName, "SISPL CA Solution");
  for (const missing of ["SISPL_EMAIL_ENDPOINT", "SISPL_EMAIL_API_KEY", "SISPL_EMAIL_FROM_ADDRESS"]) {
    assert.throws(() => readEmailTransportConfig({ ...base, [missing]: "" }), new RegExp(missing));
  }
  assert.throws(() => readEmailTransportConfig({ ...base, SISPL_EMAIL_ENDPOINT: "http://mail.example.com" }), /only use http for a local endpoint/);
  assert.throws(() => readEmailTransportConfig({ ...base, SISPL_EMAIL_FROM_ADDRESS: "not-an-address" }), /valid email address/);
  assert.doesNotThrow(() => readEmailTransportConfig({ ...base, SISPL_EMAIL_ENDPOINT: "http://localhost:4000/send" }));
});

test("Indian mobile numbers normalise to E.164 digits and unusable numbers are rejected", () => {
  assert.equal(toWhatsappRecipient("98765 43210", "91"), "919876543210");
  assert.equal(toWhatsappRecipient("+91 98765 43210", "91"), "919876543210");
  assert.equal(toWhatsappRecipient("919876543210", "91"), "919876543210");
  assert.equal(toWhatsappRecipient("", "91"), null);
  assert.equal(toWhatsappRecipient("12345", "91"), null);
});

test("WhatsApp configuration validates the template name and dialling code", () => {
  const base = {
    SISPL_WHATSAPP_TRANSPORT: "cloud_api",
    SISPL_WHATSAPP_ENDPOINT: "https://graph.facebook.com/v21.0/1234/messages",
    SISPL_WHATSAPP_ACCESS_TOKEN: "token",
  };
  assert.equal(readWhatsappTransportConfig(base).templateName, "sispl_practice_alert");
  assert.equal(readWhatsappTransportConfig(base).defaultCountryCode, "91");
  assert.throws(() => readWhatsappTransportConfig({ ...base, SISPL_WHATSAPP_TEMPLATE: "Not Valid" }), /lowercase template name/);
  assert.throws(() => readWhatsappTransportConfig({ ...base, SISPL_WHATSAPP_COUNTRY_CODE: "abc" }), /numeric dialling code/);
  assert.throws(() => readWhatsappTransportConfig({ ...base, SISPL_WHATSAPP_ACCESS_TOKEN: "" }), /SISPL_WHATSAPP_ACCESS_TOKEN/);
});

test("rendered bodies escape untrusted content and name the firm", () => {
  const html = renderHtmlBody({ ...message, title: "Ram & Co <script>alert(1)</script>" });
  assert.ok(html.includes("Ram &amp; Co &lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Sharma &amp; Kumar"));
  assert.ok(renderPlainTextBody(message).includes("Sharma & Kumar"));
});

test("the email transport posts a bearer-authenticated payload the provider can send", async () => {
  received.length = 0;
  const transport = createHttpEmailTransport({
    endpoint: `http://127.0.0.1:${port}/emails`,
    apiKey: "secret-key",
    fromAddress: "alerts@firm.example",
    fromName: "Sharma & Kumar",
  });
  await transport.send(message);
  assert.equal(received.length, 1);
  assert.equal(received[0].auth, "Bearer secret-key");
  const body = received[0].body as { from: string; to: string[]; subject: string; text: string; html: string };
  assert.equal(body.from, "Sharma & Kumar <alerts@firm.example>");
  assert.deepEqual(body.to, ["nisha@example.invalid"]);
  assert.equal(body.subject, message.title);
  assert.ok(body.html.includes("GSTR 3B"));
});

test("the WhatsApp transport sends an approved template to the normalised number", async () => {
  received.length = 0;
  const transport = createWhatsappTransport({
    endpoint: `http://127.0.0.1:${port}/messages`,
    accessToken: "wa-token",
    templateName: "sispl_practice_alert",
    defaultCountryCode: "91",
  });
  await transport.send({ ...message, channel: "whatsapp" });
  const body = received[0].body as { to: string; type: string; template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> } };
  assert.equal(body.to, "919876543210");
  assert.equal(body.type, "template");
  assert.equal(body.template.name, "sispl_practice_alert");
  assert.equal(body.template.components[0].parameters[0].text, message.title);
});

test("a recipient without a usable mobile number fails loudly instead of sending nowhere", async () => {
  const transport = createWhatsappTransport({
    endpoint: `http://127.0.0.1:${port}/messages`, accessToken: "wa-token",
    templateName: "sispl_practice_alert", defaultCountryCode: "91",
  });
  await assert.rejects(() => transport.send({ ...message, channel: "whatsapp", recipientPhone: null }), /no usable mobile number/);
  await assert.rejects(() => transport.send({ ...message, channel: "whatsapp", recipientPhone: "123" }), /no usable mobile number/);
});

test("provider failures surface the status without leaking the credential in the error", async () => {
  const transport = createHttpEmailTransport({
    endpoint: `http://127.0.0.1:${port}/emails?fail=1`,
    apiKey: "secret-key", fromAddress: "alerts@firm.example", fromName: "Firm",
  });
  await assert.rejects(
    () => transport.send(message),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Provider responded 422/);
      assert.ok(!error.message.includes("dummy_token_abcdefghijklmnopqrstuvwx"), "long tokens in provider errors must be redacted");
      assert.ok(error.message.includes("[redacted]"));
      return true;
    },
  );
});
