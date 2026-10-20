// Envoi d'emails transactionnels via l'API Brevo (HTTP). Node 18+ (fetch global).
const APP_URL = process.env.APP_URL || 'https://ducotetraiteur.cleverapps.io';

function mailConfigured() {
  return !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

async function sendMail({ to, toName, subject, html }) {
  if (!process.env.BREVO_API_KEY) throw new Error("Envoi d'email non configuré (BREVO_API_KEY manquante sur le serveur).");
  if (!process.env.MAIL_FROM) throw new Error("Envoi d'email non configuré (MAIL_FROM manquante sur le serveur).");
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'Du Côté Traiteur' },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { const b = await res.json(); detail = b && (b.message || b.code) ? ` — ${b.message || b.code}` : ''; } catch (_) {}
    throw new Error(`Brevo a refusé l'envoi (HTTP ${res.status})${detail}`);
  }
  return true;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

// Email d'accès : lien + identifiants + process d'icône selon le support
function buildAccessEmail({ nom, email, motdepasse }) {
  const lien = APP_URL;
  const G = '#1E3D30', GOLD = '#C8A24B', CREAM = '#F8F5EE', INK = '#221F18', SOFT = '#5C5749';
  const card = `background:#fff;border:1px solid #e7e0d2;border-radius:12px;padding:18px 20px;margin:14px 0`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:${CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:${G};color:#fff;border-radius:14px;padding:22px 24px;text-align:center">
      <div style="font-size:20px;font-weight:700;letter-spacing:.01em">Du Côté Traiteur</div>
      <div style="font-size:13px;color:${GOLD};margin-top:4px;text-transform:uppercase;letter-spacing:.08em">Espace de gestion</div>
    </div>
    <p style="font-size:15px;margin:20px 2px 0">Bonjour ${esc(nom)},</p>
    <p style="font-size:15px;line-height:1.5;margin:8px 2px 0">Voici votre accès à l'espace de gestion. Cliquez sur le lien, connectez-vous avec vos identifiants, puis (facultatif) ajoutez l'icône sur votre appareil.</p>
    <div style="text-align:center;margin:20px 0">
      <a href="${esc(lien)}" style="display:inline-block;background:${GOLD};color:${G};font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:15px">Ouvrir l'application</a>
      <div style="font-size:12px;color:${SOFT};margin-top:8px"><a href="${esc(lien)}" style="color:${SOFT}">${esc(lien)}</a></div>
    </div>
    <div style="${card}">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:${SOFT};font-weight:700;margin-bottom:8px">Vos identifiants</div>
      <div style="font-size:15px">Email : <b>${esc(email)}</b></div>
      <div style="font-size:15px;margin-top:4px">Mot de passe : <b style="font-family:'Courier New',monospace">${esc(motdepasse)}</b></div>
      <div style="font-size:12.5px;color:${SOFT};margin-top:10px">Vous pourrez le changer une fois connecté, via « Mon mot de passe ».</div>
    </div>
    <div style="${card}">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:${SOFT};font-weight:700;margin-bottom:10px">Ajouter l'icône sur l'écran d'accueil</div>
      <p style="font-size:14px;line-height:1.5;margin:0 0 8px"><b>📱 iPhone / iPad (Safari)</b><br>Ouvrez le lien dans Safari, touchez le bouton <b>Partager</b> (carré avec flèche), puis <b>« Sur l'écran d'accueil »</b>.</p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 8px"><b>🤖 Android (Chrome)</b><br>Ouvrez le lien dans Chrome, touchez le menu <b>⋮</b> en haut à droite, puis <b>« Installer l'application »</b> (ou « Ajouter à l'écran d'accueil »).</p>
      <p style="font-size:14px;line-height:1.5;margin:0"><b>💻 Ordinateur (Chrome / Edge)</b><br>Ouvrez le lien, cliquez sur l'icône d'<b>installation</b> dans la barre d'adresse (à droite), puis <b>Installer</b>.</p>
    </div>
    <p style="font-size:12px;color:${SOFT};margin:18px 2px 0">Message automatique — Du Côté Traiteur.</p>
  </div></body></html>`;
  return { subject: 'Votre accès — Du Côté Traiteur', html };
}

module.exports = { sendMail, buildAccessEmail, mailConfigured, APP_URL };
