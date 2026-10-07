/**
 * nodemailer 10 upgrade probe.
 *
 * Runs a minimal SMTP server and sends a real message through EmailService —
 * the same code path ticket notifications, MFA codes and invoice emails use — so the
 * upgrade is verified against an actual SMTP conversation (envelope, headers, HTML part,
 * inline attachment), not just a successful import.
 */
import { createServer, type Server } from "node:net";
import { EmailService } from "@C7NTAX/email";

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

interface Captured { from: string; to: string[]; data: string }

function startSmtp(): Promise<{ server: Server; port: number; messages: Captured[] }> {
  const messages: Captured[] = [];
  const server = createServer(socket => {
    let message: Captured = { from: "", to: [], data: "" };
    let inData = false;
    socket.write("220 probe.local ESMTP ready\r\n");
    socket.on("data", chunk => {
      const text = chunk.toString("utf8");
      if (inData) {
        message.data += text;
        if (message.data.includes("\r\n.\r\n")) {
          inData = false;
          message.data = message.data.slice(0, message.data.indexOf("\r\n.\r\n"));
          messages.push(message);
          socket.write("250 2.0.0 Ok: queued\r\n");
        }
        return;
      }
      for (const rawLine of text.split("\r\n").filter(Boolean)) {
        const line = rawLine.trim();
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          // No AUTH advertised: the client must not try to authenticate, and STARTTLS is
          // deliberately absent so the conversation stays readable.
          socket.write("250-probe.local\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n");
        } else if (upper.startsWith("MAIL FROM")) {
          message.from = line.replace(/^MAIL FROM:\s*/i, "").replace(/[<>]/g, "");
          socket.write("250 2.1.0 Ok\r\n");
        } else if (upper.startsWith("RCPT TO")) {
          message.to.push(line.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, ""));
          socket.write("250 2.1.5 Ok\r\n");
        } else if (upper === "DATA") {
          inData = true;
          message.data = "";
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else if (upper === "RSET") {
          message = { from: "", to: [], data: "" };
          socket.write("250 2.0.0 Ok\r\n");
        } else {
          socket.write("250 2.0.0 Ok\r\n");
        }
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, messages }));
  });
}

async function main() {
const { server, port, messages } = await startSmtp();
const service = new EmailService({ host: "127.0.0.1", port, user: "", pass: "", from: "probe@c7ntax.local" });

const verified = await service.verify();
check(verified, "SMTP connection verifies (transporter.verify)");

const sent = await service.send({
  to: ["client@example.com"],
  cc: ["manager@example.com"],
  subject: "Ticket #1234 was updated",
  html: "<p>Hello <b>client</b>, we added a note.</p>",
  text: "Hello client, we added a note.",
  attachments: [{
    filename: "logo.png",
    content: Buffer.from("89504e470d0a1a0a", "hex"),
    contentType: "image/png",
    cid: "logo@c7ntax",
    contentDisposition: "inline",
  }],
});
check(typeof sent.messageId === "string" && sent.messageId.length > 3, `send returns a messageId (${sent.messageId})`);

check(messages.length === 1, `the SMTP server received one message (${messages.length})`);
const msg = messages[0];
if (msg) {
  check(msg.from === "probe@c7ntax.local", `envelope sender is the configured from (${msg.from})`);
  check(msg.to.includes("client@example.com") && msg.to.includes("manager@example.com"), `envelope recipients include to and cc (${msg.to.join(", ")})`);
  check(/subject: Ticket #1234 was updated/i.test(msg.data), "the subject survives the SMTP conversation");
  check(/we added a note/i.test(msg.data), "the HTML body is in the message");
  check(/name="logo@c7ntax"/i.test(msg.data) || /logo\.png/i.test(msg.data), "the inline attachment is in the message");
  check(/multipart\/alternative/i.test(msg.data), "text and HTML are sent as multipart/alternative");
}

await service.sendMfaCode("user@example.com", "123456");
check(messages.length === 2 && /123456/.test(messages[1]?.data || ""), "the MFA path sends through the same transport");

server.close();
console.log(`\n${pass} passed, ${fail} failed`);

}
void main().then(() => process.exit(fail === 0 ? 0 : 1));

