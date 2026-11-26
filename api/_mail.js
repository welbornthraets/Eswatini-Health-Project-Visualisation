"use strict";
/* Emails the admins through Gmail (smtp.gmail.com, TLS on port 465) with Node's own tls module.

   Settings in Vercel:
     GMAIL_USER          the Gmail address that sends the emails
     GMAIL_APP_PASSWORD  an App password for that Gmail (Google Account -> Security ->
                         2-Step Verification -> App passwords); spaces are ignored */
const tls = require("tls");
const crypto = require("crypto");

const HOST = () => process.env.SMTP_HOST || "smtp.gmail.com";
const PORT = () => Number(process.env.SMTP_PORT || 465);
const user = () => String(process.env.GMAIL_USER || "").trim();
const pass = () => String(process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const configured = () => /^[^@\s]+@[^@\s]+$/.test(user()) && pass().length > 0;
const oneLine = s => String(s).replace(/[\r\n]+/g, " ").trim();

function smtp(lines){
  return new Promise((resolve, reject) => {
    const sock = tls.connect({host:HOST(), port:PORT(), servername:HOST()});
    let buf = "", waiting = null, done = false;
    const fail = e => { if (done) return; done = true; sock.destroy(); reject(e); };
    sock.setTimeout(20000, () => fail(new Error("the mail server did not answer in time")));
    sock.on("error", e => fail(new Error("could not reach the mail server (" + e.code + ")")));
    // A reply is complete at a line "NNN text" (a dash after the code means more lines follow).
    const check = () => {
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (m && waiting){ const w = waiting; waiting = null; const text = buf; buf = ""; w({code:Number(m[1]), text}); }
    };
    sock.on("data", d => { buf += d.toString("utf8"); check(); });
    const reply = () => new Promise(r => { waiting = r; check(); });
    (async () => {
      for (const [cmd, ok, label] of lines){
        if (cmd !== null) sock.write(cmd + "\r\n");
        const r = await reply();
        if (!ok.includes(r.code)){
          const why = r.code === 535 ? "Gmail did not accept GMAIL_USER and GMAIL_APP_PASSWORD" : `the mail server said ${r.code} at ${label}`;
          return fail(new Error(why));
        }
      }
      done = true; sock.end(); resolve();
    })().catch(fail);
  });
}

// to: list of addresses. text: plain-text body.
async function send(to, subject, text){
  if (!configured()) throw new Error("email is not set up (GMAIL_USER and GMAIL_APP_PASSWORD in Vercel)");
  const from = user(), id = crypto.randomBytes(12).toString("hex");
  const body = Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const message = [
    `From: "Eswatini TB Map" <${oneLine(from)}>`,
    `To: ${to.map(oneLine).join(", ")}`,
    `Subject: ${oneLine(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "", body].join("\r\n");
  await smtp([
    [null, [220], "connect"],
    ["EHLO eswatini-tb-map", [250], "hello"],
    ["AUTH PLAIN " + Buffer.from("\0" + from + "\0" + pass()).toString("base64"), [235], "sign-in"],
    [`MAIL FROM:<${from}>`, [250], "sender"],
    ...to.map(a => [`RCPT TO:<${oneLine(a)}>`, [250, 251], "recipient"]),
    ["DATA", [354], "data"],
    [message + "\r\n.", [250], "sending"],
    ["QUIT", [221], "quit"],
  ]);
}

module.exports = {send, configured};
