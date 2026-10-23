// Fonction serveur de la boutique Emmanuel Alimi (Supabase Edge Function « boutique »).
// Actions (POST JSON { action, ... }) :
//   creer     : enregistre la commande et crée le paiement PayPal (public)
//   capturer  : encaisse le paiement, envoie le bon de commande (public)
//   suivi     : renvoie le statut d'une commande à partir de son lien de suivi (public)
//   statut    : change le statut d'une commande et prévient le client (administrateur)
//   renvoyer  : renvoie le bon de commande au client (administrateur)
//
// Secrets à définir dans Supabase › Edge Functions › Secrets :
//   PAYPAL_CLIENT_ID, PAYPAL_SECRET, RESEND_API_KEY
// Facultatifs : PAYPAL_ENV (live | sandbox, défaut live), EMAIL_FROM, ADMIN_EMAIL, SITE_URL

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "alimiproductions@gmail.com";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://www.emmanuelalimi.com").replace(/\/$/, "");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Emmanuel Alimi <commandes@emmanuelalimi.com>";
const PAYPAL_API = (Deno.env.get("PAYPAL_ENV") ?? "live") === "sandbox"
  ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const OPTIONS: Record<string, string> = { encadre: "Encadré", print: "Print seul" };
const STATUTS: Record<string, string> = {
  en_attente: "En attente de paiement", payee: "Payée", en_preparation: "En préparation",
  expediee: "Expédiée", livree: "Livrée", annulee: "Annulée",
};
const ref = (n: number) => `AL-${n}`;
const money = (n: number) => `${Number(n).toLocaleString("fr-FR")} ₪`;
const clean = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
// Zones de livraison : supplément payé par le client, en plus du prix (livraison en Israël incluse).
const ZONES_DEFAUT = [
  { code: "IL", nom: "Israël", encadre: 0, print: 0 },
  { code: "FR", nom: "France", encadre: 150, print: 50 },
  { code: "NA", nom: "États-Unis et Canada", encadre: 200, print: 70 },
  { code: "WW", nom: "Reste du monde", encadre: 220, print: 80 },
];
const zonesDe = (r: any) => (Array.isArray(r?.zones) && r.zones.length ? r.zones : ZONES_DEFAUT);
const adresseHtml = (c: any) =>
  `${esc(c.adresse)}<br>${esc(c.code_postal)} ${esc(c.ville)}${c.pays && c.pays !== "Israël" ? `<br>${esc(c.pays)}` : ""}`;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ---------- PayPal ----------
async function paypalToken(): Promise<string> {
  const id = Deno.env.get("PAYPAL_CLIENT_ID"), secret = Deno.env.get("PAYPAL_SECRET");
  if (!id || !secret) throw new HttpError(500, "PayPal n'est pas configuré.");
  const r = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${id}:${secret}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new HttpError(502, "Connexion à PayPal impossible.");
  return (await r.json()).access_token;
}
async function paypal(path: string, body?: unknown) {
  const r = await fetch(`${PAYPAL_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await paypalToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}

// ---------- e-mails (Resend) ----------
async function sendMail(to: string, subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.error("RESEND_API_KEY manquant"); return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], reply_to: ADMIN_EMAIL, subject, html }),
  });
  if (!r.ok) console.error("Resend", r.status, await r.text());
  return r.ok;
}

function layout(title: string, body: string) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f1f1ee;font-family:Arial,Helvetica,sans-serif;color:#141413">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<p style="font:bold 13px Arial;letter-spacing:.14em;text-transform:uppercase;margin:0 0 24px">Emmanuel Alimi</p>
<div style="background:#ffffff;padding:28px 24px;border-radius:6px">
<h1 style="font:bold 22px/1.25 Arial;margin:0 0 16px">${title}</h1>${body}</div>
<p style="font-size:12px;color:#6b6b66;margin:20px 0 0">Une question ? Répondez simplement à cet e-mail.<br><a href="${SITE_URL}" style="color:#6b6b66">emmanuelalimi.com</a></p>
</div></body></html>`;
}
const row = (k: string, v: string) =>
  `<tr><td style="padding:6px 0;color:#6b6b66;font-size:14px;vertical-align:top;width:40%">${k}</td><td style="padding:6px 0;font-size:14px">${v}</td></tr>`;
const button = (href: string, label: string) =>
  `<p style="margin:24px 0 0"><a href="${href}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:999px;font:bold 13px Arial;letter-spacing:.06em;text-transform:uppercase">${label}</a></p>`;
const suiviUrl = (c: any) => `${SITE_URL}/#suivi/${c.token}`;

function bonDeCommande(c: any, delai: string) {
  const body = `<p style="font-size:15px;line-height:1.55;margin:0 0 18px">Bonjour ${esc(c.client_nom)},<br>merci pour votre commande. Votre paiement est bien reçu. Votre print est préparé à l'atelier sous ${esc(delai)}, puis livré à votre domicile.</p>
<table style="width:100%;border-collapse:collapse;border-top:1px solid #dcdcd6">
${row("Commande", `<b>${ref(c.numero)}</b>`)}
${row("Date", new Date(c.paye_le ?? c.created_at).toLocaleDateString("fr-FR", { timeZone: "Asia/Jerusalem" }))}
${row("Œuvre", esc(c.produit_titre))}
${row("Option", `${OPTIONS[c.option]}${c.option_detail ? `<br><span style="color:#6b6b66">${esc(c.option_detail)}</span>` : ""}`)}
${Number(c.frais_livraison) > 0
    ? `${row("Prix du print", money(Number(c.prix) - Number(c.frais_livraison)))}${row(`Livraison (${esc(c.pays)})`, money(c.frais_livraison))}`
    : row("Livraison", "Incluse, à domicile")}
${row("Total payé", `<b>${money(c.prix)}</b>`)}
${row("Livré à", `${esc(c.client_nom)}<br>${adresseHtml(c)}${c.client_tel ? `<br>${esc(c.client_tel)}` : ""}`)}
</table>${button(suiviUrl(c), "Suivre ma commande")}`;
  return layout(`Bon de commande ${ref(c.numero)}`, body);
}

function mailStatut(c: any, message: string) {
  const texts: Record<string, string> = {
    en_preparation: "Votre print est en cours de préparation à l'atelier : impression, signature et encadrement.",
    expediee: "Votre commande est partie de l'atelier. Elle sera livrée à votre domicile.",
    livree: "Votre commande a été livrée. Merci, et belle accroche !",
    annulee: "Votre commande a été annulée. Si vous avez été débité, le remboursement est effectué sur votre moyen de paiement.",
    payee: "Votre paiement est bien reçu.",
  };
  let body = `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">Bonjour ${esc(c.client_nom)},<br>${texts[c.statut] ?? ""}</p>`;
  if (message) body += `<p style="font-size:15px;line-height:1.55;margin:0 0 14px;padding:12px 14px;background:#f1f1ee;border-radius:4px">${esc(message).replace(/\n/g, "<br>")}</p>`;
  if (c.statut === "expediee" && (c.transporteur || c.suivi_numero)) {
    body += `<table style="width:100%;border-collapse:collapse;border-top:1px solid #dcdcd6">
${c.transporteur ? row("Transporteur", esc(c.transporteur)) : ""}${c.suivi_numero ? row("Numéro de suivi", `<b>${esc(c.suivi_numero)}</b>`) : ""}
${c.suivi_url ? row("Suivi du colis", `<a href="${esc(c.suivi_url)}">Suivre le colis</a>`) : ""}</table>`;
  }
  body += button(suiviUrl(c), "Voir ma commande");
  return layout(`Commande ${ref(c.numero)} : ${STATUTS[c.statut].toLowerCase()}`, body);
}

function mailAdmin(c: any) {
  const body = `<table style="width:100%;border-collapse:collapse">
${row("Commande", `<b>${ref(c.numero)}</b>`)}${row("Œuvre", esc(c.produit_titre))}${row("Option", OPTIONS[c.option])}
${row("Montant", `${money(c.prix)}${Number(c.frais_livraison) > 0 ? ` dont livraison ${money(c.frais_livraison)}` : ""}`)}${row("Client", `${esc(c.client_nom)}<br>${esc(c.client_email)}<br>${esc(c.client_tel)}`)}
${row("Adresse", adresseHtml(c))}${c.note_client ? row("Note du client", esc(c.note_client)) : ""}</table>
${button(`${SITE_URL}/admin.html`, "Ouvrir la gestion")}`;
  return layout(`Nouvelle commande ${ref(c.numero)} · ${money(c.prix)}`, body);
}

async function reglages() {
  const { data } = await db.from("reglages").select("*").eq("id", 1).single();
  return data ?? {};
}
async function log(commande_id: string, statut: string, message = "", email_envoye = false) {
  await db.from("historique").insert({ commande_id, statut, message, email_envoye });
}

// ---------- actions publiques ----------
async function creer(b: any) {
  if (b.site) throw new HttpError(400, "Requête refusée."); // champ piège anti-robots
  const option = b.option === "print" ? "print" : b.option === "encadre" ? "encadre" : null;
  const k = b.client ?? {};
  const client = {
    client_nom: clean(k.nom, 120), client_email: clean(k.email, 160).toLowerCase(), client_tel: clean(k.tel, 40),
    adresse: clean(k.adresse, 240), ville: clean(k.ville, 80), code_postal: clean(k.code_postal, 20), note_client: clean(k.note, 600),
    pays: clean(k.pays, 80),
  };
  if (!option) throw new HttpError(400, "Option inconnue.");
  if (!client.client_nom || !client.adresse || !client.ville) throw new HttpError(400, "Merci de remplir le nom et l'adresse de livraison.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.client_email)) throw new HttpError(400, "L'adresse e-mail n'est pas valide.");
  if (!client.client_tel) throw new HttpError(400, "Merci d'indiquer un téléphone pour le livreur.");

  const { data: p } = await db.from("produits").select("*").eq("id", clean(b.produit_id, 60)).maybeSingle();
  if (!p || p.statut !== "disponible") throw new HttpError(409, "Ce print n'est plus disponible.");
  if (p.edition > 0 && p.vendus >= p.edition) throw new HttpError(409, "Cette édition est épuisée.");
  const base = Number(option === "encadre" ? p.prix_encadre : p.prix_print);
  if (!(base > 0)) throw new HttpError(409, "Cette option n'est pas proposée.");

  const r = await reglages();
  const zone = zonesDe(r).find((z: any) => z.code === clean(b.zone, 8)) ?? zonesDe(r)[0];
  if (zone.code === "IL") client.pays = "Israël";
  else if (!client.pays) client.pays = zone.code === "FR" ? "France" : "";
  if (!client.pays) throw new HttpError(400, "Merci d'indiquer le pays de livraison.");
  const frais_livraison = Math.max(0, Number(zone[option]) || 0);
  const prix = base + frais_livraison;
  const { data: c, error } = await db.from("commandes").insert({
    ...client, produit_id: p.id, produit_titre: p.titre, option,
    option_detail: option === "encadre" ? r.format_encadre : r.format_print, prix,
    cout_impression: r.cout_impression ?? 0,
    cout_cadre: option === "encadre" ? (r.cout_cadre ?? 0) : 0,
    cout_emballage: option === "encadre" ? (r.cout_emballage_encadre ?? 0) : (r.cout_emballage_print ?? 0),
    zone: zone.code, frais_livraison,
    cout_livraison: Number(r.cout_livraison ?? 0) + frais_livraison,
    frais_paiement: Math.round((prix * (r.frais_pct ?? 0) / 100 + Number(r.frais_fixe ?? 0)) * 100) / 100,
  }).select().single();
  if (error || !c) throw new HttpError(500, "La commande n'a pas pu être enregistrée.");

  const pp = await paypal("/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: c.id, custom_id: c.id, invoice_id: ref(c.numero),
      description: `${p.titre} · ${OPTIONS[option]}`.slice(0, 127),
      amount: { currency_code: "ILS", value: prix.toFixed(2) },
    }],
    application_context: { brand_name: "Emmanuel Alimi", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", locale: "fr-FR" },
  });
  if (!pp.ok) { console.error("PayPal create", pp.status, JSON.stringify(pp.data)); throw new HttpError(502, "Le paiement n'a pas pu démarrer."); }
  await db.from("commandes").update({ paypal_order_id: pp.data.id }).eq("id", c.id);
  await log(c.id, "en_attente");
  return { paypal_id: pp.data.id, numero: ref(c.numero) };
}

async function capturer(b: any) {
  const pid = clean(b.paypal_id, 60);
  const { data: c } = await db.from("commandes").select("*").eq("paypal_order_id", pid).maybeSingle();
  if (!c) throw new HttpError(404, "Commande introuvable.");
  if (c.statut !== "en_attente") return { numero: ref(c.numero), token: c.token };

  const pp = await paypal(`/v2/checkout/orders/${encodeURIComponent(pid)}/capture`);
  const cap = pp.data?.purchase_units?.[0]?.payments?.captures?.[0];
  if (!pp.ok || pp.data?.status !== "COMPLETED" || !cap) {
    console.error("PayPal capture", pp.status, JSON.stringify(pp.data));
    const issue = pp.data?.details?.[0]?.issue;
    if (issue === "INSTRUMENT_DECLINED") throw new HttpError(402, "Le paiement a été refusé. Essayez un autre moyen de paiement.");
    throw new HttpError(502, "Le paiement n'a pas abouti.");
  }
  if (cap.amount?.currency_code !== "ILS" || Number(cap.amount?.value) !== Number(c.prix)) {
    await db.from("commandes").update({ note_interne: `Montant PayPal inattendu : ${cap.amount?.value} ${cap.amount?.currency_code}` }).eq("id", c.id);
  }
  const fee = Number(cap.seller_receivable_breakdown?.paypal_fee?.value);
  const { data: paid } = await db.from("commandes").update({
    statut: "payee", paye_le: new Date().toISOString(), paypal_capture_id: cap.id,
    ...(fee > 0 ? { frais_paiement: fee } : {}),
  }).eq("id", c.id).select().single();
  if (c.produit_id) {
    const { data: p } = await db.from("produits").select("vendus").eq("id", c.produit_id).single();
    if (p) await db.from("produits").update({ vendus: (p.vendus ?? 0) + 1 }).eq("id", c.produit_id);
  }
  const r = await reglages();
  const sent = await sendMail(paid.client_email, `Bon de commande ${ref(paid.numero)} · Emmanuel Alimi`, bonDeCommande(paid, r.delai ?? "5 à 7 jours"));
  await log(c.id, "payee", "", sent);
  await sendMail(ADMIN_EMAIL, `Nouvelle commande ${ref(paid.numero)} · ${paid.produit_titre} · ${money(paid.prix)}`, mailAdmin(paid));
  return { numero: ref(paid.numero), token: paid.token };
}

async function suivi(b: any) {
  const token = clean(b.token, 80);
  if (!/^[a-f0-9]{32}$/.test(token)) throw new HttpError(404, "Commande introuvable.");
  const { data: c } = await db.from("commandes").select("*").eq("token", token).maybeSingle();
  if (!c || c.statut === "en_attente") throw new HttpError(404, "Commande introuvable.");
  const { data: h } = await db.from("historique").select("statut,message,created_at").eq("commande_id", c.id)
    .neq("statut", "en_attente").order("created_at");
  return {
    numero: ref(c.numero), statut: c.statut, statut_label: STATUTS[c.statut], date: c.paye_le ?? c.created_at,
    produit: c.produit_titre, option: OPTIONS[c.option], option_detail: c.option_detail, prix: c.prix,
    frais_livraison: c.frais_livraison, pays: c.pays,
    client_nom: c.client_nom, ville: c.ville, transporteur: c.transporteur, suivi_numero: c.suivi_numero, suivi_url: c.suivi_url,
    historique: (h ?? []).map((x) => ({ ...x, label: STATUTS[x.statut] ?? x.statut })),
  };
}

// ---------- actions administrateur ----------
async function requireAdmin(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = await db.auth.getUser(jwt);
  if (data?.user?.email?.toLowerCase() !== ADMIN_EMAIL) throw new HttpError(403, "Accès réservé.");
}

async function changerStatut(b: any) {
  const statut = clean(b.statut, 30);
  if (!STATUTS[statut] || statut === "en_attente") throw new HttpError(400, "Statut inconnu.");
  const { data: c } = await db.from("commandes").select("*").eq("id", clean(b.commande_id, 60)).single();
  if (!c) throw new HttpError(404, "Commande introuvable.");
  const patch: Record<string, unknown> = { statut };
  for (const f of ["transporteur", "suivi_numero", "suivi_url"]) if (b[f] !== undefined) patch[f] = clean(b[f], 300);
  if (b.cout_livraison !== undefined && b.cout_livraison !== "") patch.cout_livraison = Number(b.cout_livraison) || 0;

  // Le stock est déduit une seule fois, au passage en préparation (ou au-delà).
  if (["en_preparation", "expediee", "livree"].includes(statut) && !c.stock_deduit) {
    const { data: items } = await db.from("stock").select("*");
    for (const it of items ?? []) {
      const n = c.option === "encadre" ? it.conso_encadre : it.conso_print;
      if (n > 0) await db.from("stock").update({ quantite: it.quantite - n }).eq("id", it.id);
    }
    patch.stock_deduit = true;
  }
  const { data: up } = await db.from("commandes").update(patch).eq("id", c.id).select().single();
  const message = clean(b.message, 1200);
  const sent = b.envoyer_email !== false ? await sendMail(up.client_email, `Commande ${ref(up.numero)} : ${STATUTS[statut].toLowerCase()}`, mailStatut(up, message)) : false;
  await log(c.id, statut, message, sent);
  return { commande: up, email_envoye: sent };
}

async function renvoyer(b: any) {
  const { data: c } = await db.from("commandes").select("*").eq("id", clean(b.commande_id, 60)).single();
  if (!c || c.statut === "en_attente") throw new HttpError(404, "Commande introuvable.");
  const r = await reglages();
  const sent = await sendMail(c.client_email, `Bon de commande ${ref(c.numero)} · Emmanuel Alimi`, bonDeCommande(c, r.delai ?? "5 à 7 jours"));
  return { email_envoye: sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    switch (b.action) {
      case "creer": return json(await creer(b));
      case "capturer": return json(await capturer(b));
      case "suivi": return json(await suivi(b));
      case "statut": await requireAdmin(req); return json(await changerStatut(b));
      case "renvoyer": await requireAdmin(req); return json(await renvoyer(b));
      default: return json({ error: "Action inconnue." }, 400);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof HttpError ? e.message : "Erreur inattendue." }, status);
  }
});
