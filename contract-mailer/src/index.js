// Cloudflare Worker: emails the signed contract.
// The email is built here from the contract page plus the submitted fields,
// so the page cannot make this Worker send arbitrary content.
//
// Vars (wrangler.toml): ALLOWED_ORIGIN, OWNER_EMAIL, FROM_EMAIL, CONTRACT_URL, SEND_CLIENT_COPY
// Secret: RESEND_API_KEY
//
// SEND_CLIENT_COPY must be exactly "true" for anything to go to the client.
// Any other value means every email goes only to OWNER_EMAIL.

const MAX_BODY = 600000;
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;

export function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cap(v, n) {
  return String(v ?? "").trim().slice(0, n);
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function cleanSig(s) {
  if (!s || typeof s !== "object") return null;
  if (s.type === "draw") {
    if (typeof s.png !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.png) || s.png.length > 250000) return null;
    return { type: "draw", png: s.png };
  }
  if (s.type === "type") {
    const text = cap(s.text, 80);
    return text.length > 1 ? { type: "type", text } : null;
  }
  return null;
}

export function cleanPayload(raw) {
  const p = {
    clientName: cap(raw.clientName, 120),
    clientContact: cap(raw.clientContact, 120),
    clientReach: cap(raw.clientReach, 60),
    clientEmail: cap(raw.clientEmail, 254),
    clientAddr: cap(raw.clientAddr, 200),
    effDate: cap(raw.effDate, 10),
    cadence: cap(raw.cadence, 3).replace(/\D/g, ""),
    providerName: cap(raw.providerName, 120),
    clientSigner: cap(raw.clientSigner, 120),
    providerSignedAt: cap(raw.providerSignedAt, 40),
    clientSignedAt: cap(raw.clientSignedAt, 40),
    providerSig: cleanSig(raw.providerSig),
    clientSig: cleanSig(raw.clientSig),
  };
  const errors = [];
  if (raw.consent !== true) errors.push("Electronic signing was not agreed to.");
  if (!p.clientName) errors.push("Dealership name is missing.");
  if (!EMAIL_RE.test(p.clientEmail)) errors.push("Enter a valid email address.");
  if (!p.providerSig || !p.clientSig) errors.push("Both signatures are required.");
  if (!fmtDate(p.effDate)) errors.push("Effective date is missing.");
  return { p, errors };
}

function between(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error("contract markers not found");
  return text.slice(a + start.length, b);
}

function sigHtml(sig, who, mode) {
  if (sig.type === "type") return `<span class="sigtype">${esc(sig.text)}</span>`;
  const src = mode === "email" ? `cid:sig-${who}` : sig.png;
  return `<img class="sigimg" src="${src}" alt="${who} signature" height="70">`;
}

export function renderAgreement(pageHtml, p, mode) {
  let doc = between(pageHtml, "<!--AGREEMENT-START-->", "<!--AGREEMENT-END-->");
  doc = doc.replace(/<!--NOEXPORT-->[\s\S]*?<!--\/NOEXPORT-->/g, "");
  doc = doc.replace(/<input[^>]*data-field="(\w+)"[^>]*>/g, (m, key) => {
    let v = p[key] ?? "";
    if (key === "effDate") v = fmtDate(v);
    return `<span class="val">${esc(v) || "________"}</span>`;
  });
  doc = doc.replace(/<div class="sigpad" data-sig="(provider|client)">[\s\S]*?<!--\/sigpad-->/g, (m, who) => sigHtml(p[who + "Sig"], who, mode));
  doc = doc.replace(/<span class="date" data-date="(provider|client)">[^<]*<\/span>/g, (m, who) => `<span class="date">${esc(p[who + "SignedAt"])}</span>`);
  return doc;
}

const DOC_CSS = `
body{margin:0;background:#f4f1f1;font:14px/1.6 Menlo,Consolas,"Courier New",monospace;color:#1a1212}
.wrap{max-width:760px;margin:0 auto;padding:18px;background:#fff}
.note{border:1px solid #c4161c;color:#7d1015;padding:10px 12px;margin:0 0 14px;font-size:13px}
.sheet{padding:14px 0 22px;border-bottom:2px solid #c4161c;margin-bottom:18px}
h2,h3,h4{font-family:Georgia,"Times New Roman",serif;margin:.9em 0 .25em;color:#111}
h2{font-size:26px}h3{font-size:18px}h4{font-size:16px}
h3 b{font:600 11px monospace;color:#c4161c;margin-right:8px}
.head span{font-style:italic;color:#666;margin-left:10px;font-size:13px}
.val{border-bottom:1px solid #999;padding:0 4px;font-weight:600}
.fields label{display:block;font-size:10px;text-transform:uppercase;color:#666;margin:6px 0}
.items{list-style:none;padding:0}.items li{margin:6px 0}.items li b{color:#c4161c;margin-right:8px}
.sig{border:1px solid #bbb;padding:12px;margin:10px 0}
.sig label{display:block;font-size:10px;text-transform:uppercase;color:#666}
.sigimg{height:70px;display:block}.sigtype{font:34px "Brush Script MT",cursive}
.sheet-foot{font-size:10px;color:#777;margin-top:14px}
`;

export function wrapHtml(inner, banner) {
  const note = banner ? `<p class="note">${esc(banner)}</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed Services Agreement</title><style>${DOC_CSS}</style></head><body><div class="wrap">${note}${inner}</div></body></html>`;
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function pngAttachments(p) {
  const out = [];
  for (const who of ["provider", "client"]) {
    const s = p[who + "Sig"];
    if (s && s.type === "draw") {
      out.push({ filename: `signature-${who}.png`, content: s.png.split(",")[1], content_type: "image/png", content_id: `sig-${who}` });
    }
  }
  return out;
}

async function sendResend(env, msg) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  return res.ok;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
}

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN;
    const origin = request.headers.get("Origin") || "";
    if (!allowed || origin !== allowed) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, origin);

    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > MAX_BODY) return json({ ok: false, error: "Request too large." }, 413, origin);

    let raw;
    try {
      raw = JSON.parse(await request.text());
    } catch {
      return json({ ok: false, error: "Bad request." }, 400, origin);
    }
    // Honeypot: bots fill the hidden field. Pretend success.
    if (raw && raw.website) return json({ ok: true, clientCopy: false }, 200, origin);

    const { p, errors } = cleanPayload(raw || {});
    if (errors.length) return json({ ok: false, error: errors[0] }, 400, origin);

    let pageHtml;
    try {
      const r = await fetch(env.CONTRACT_URL);
      if (!r.ok) throw new Error("page " + r.status);
      pageHtml = await r.text();
    } catch {
      return json({ ok: false, error: "Could not load the contract text. Try again." }, 502, origin);
    }

    let emailDoc, fileDoc;
    try {
      emailDoc = renderAgreement(pageHtml, p, "email");
      fileDoc = wrapHtml(renderAgreement(pageHtml, p, "file"));
    } catch {
      return json({ ok: false, error: "Could not build the signed copy." }, 500, origin);
    }

    const owner = env.OWNER_EMAIL;
    const sendClient = env.SEND_CLIENT_COPY === "true";
    const base = {
      from: env.FROM_EMAIL,
      attachments: [
        { filename: "Signed-Services-Agreement.html", content: b64(fileDoc), content_type: "text/html" },
        ...pngAttachments(p),
      ],
    };
    const subject = `Signed agreement: ${p.clientName}`;

    let clientCopy = false;
    if (sendClient) {
      clientCopy = await sendResend(env, {
        ...base,
        to: [p.clientEmail],
        bcc: [owner],
        subject,
        html: wrapHtml(emailDoc, null),
      });
    }
    if (!clientCopy) {
      const banner = sendClient
        ? "The copy to the client could not be delivered. Forward this to them yourself."
        : "TEST MODE: no copy was sent to the client. This went only to you.";
      const ok = await sendResend(env, {
        ...base,
        to: [owner],
        subject: (sendClient ? "" : "[TEST] ") + subject,
        html: wrapHtml(emailDoc, banner),
      });
      if (!ok) return json({ ok: false, error: "Could not send the email. Save a copy and send it by hand." }, 502, origin);
    }
    return json({ ok: true, clientCopy }, 200, origin);
  },
};
