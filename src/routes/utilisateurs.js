const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAccountManager, hashPassword } = require('../auth');
const { sendMail, buildAccessEmail } = require('../mailer');
const ah = require('../ah');

const ROLES = ['admin', 'manager', 'chef', 'cuisinier', 'preparateur', 'maitre_hotel', 'serveur'];

// Mot de passe temporaire lisible (sans caractères ambigus)
function genPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

// Toutes les routes de gestion des comptes sont réservées à l'admin ou au gérant
router.use(requireAccountManager);

// Liste des utilisateurs (sans le mot de passe)
router.get('/', ah(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nom, email, role, bloque, cree_le FROM utilisateurs ORDER BY nom');
  res.json(rows);
}));

// Créer un utilisateur (option : envoyer les accès par email)
router.post('/', ah(async (req, res) => {
  const { nom, email, mot_de_passe, role, envoyer_email } = req.body || {};
  if (!nom || !email || !mot_de_passe || !role)
    return res.status(400).json({ error: 'nom, email, mot_de_passe et role requis' });
  if (!ROLES.includes(role))
    return res.status(400).json({ error: 'role invalide (admin, manager, chef, cuisinier, preparateur)' });

  const hash = await hashPassword(mot_de_passe);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (nom, email, mot_de_passe, role)
       VALUES ($1, $2, $3, $4)
     RETURNING id, nom, email, role, bloque`,
    [nom, email, hash, role]);
  const u = rows[0];
  let email_envoye = null, email_erreur = null;
  if (envoyer_email) {
    try {
      const { subject, html } = buildAccessEmail({ nom, email, motdepasse: mot_de_passe });
      await sendMail({ to: email, toName: nom, subject, html });
      email_envoye = true;
    } catch (e) { email_envoye = false; email_erreur = e.message; }
  }
  res.status(201).json({ ...u, email_envoye, email_erreur });
}));

// Renvoyer l'accès : régénère un mot de passe temporaire et l'envoie par email
router.post('/:id/envoyer-acces', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT id, nom, email FROM utilisateurs WHERE id = $1', [Number(req.params.id)]);
  const u = rows[0];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!u.email) return res.status(400).json({ error: "Cet utilisateur n'a pas d'adresse email" });
  const mdp = genPassword();
  // Envoi d'abord : on ne change le mot de passe que si l'email est bien parti
  const { subject, html } = buildAccessEmail({ nom: u.nom, email: u.email, motdepasse: mdp });
  await sendMail({ to: u.email, toName: u.nom, subject, html });
  const hash = await hashPassword(mdp);
  await pool.query('UPDATE utilisateurs SET mot_de_passe = $1 WHERE id = $2', [hash, u.id]);
  res.json({ ok: true, email: u.email });
}));

// Bloquer / débloquer un compte
router.put('/:id/blocage', ah(async (req, res) => {
  const { bloque } = req.body || {};
  if (typeof bloque !== 'boolean')
    return res.status(400).json({ error: 'bloque (booléen) requis' });
  if (String(req.user.id) === String(req.params.id))
    return res.status(400).json({ error: 'Vous ne pouvez pas bloquer votre propre compte' });

  const { rows } = await pool.query(
    'UPDATE utilisateurs SET bloque = $1 WHERE id = $2 RETURNING id, nom, email, role, bloque',
    [bloque, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(rows[0]);
}));

// Réinitialiser le mot de passe d'un compte (par l'admin/gérant)
router.put('/:id/motdepasse', ah(async (req, res) => {
  const { mot_de_passe } = req.body || {};
  if (!mot_de_passe || String(mot_de_passe).length < 8)
    return res.status(400).json({ error: 'Mot de passe trop court (8 caractères min)' });
  const hash = await hashPassword(mot_de_passe);
  const { rows } = await pool.query('UPDATE utilisateurs SET mot_de_passe=$1 WHERE id=$2 RETURNING id, nom, email, role, bloque', [hash, Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(rows[0]);
}));

// Supprimer un compte
router.delete('/:id', ah(async (req, res) => {
  if (String(req.user.id) === String(req.params.id))
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });

  const { rows: cible } = await pool.query(
    'SELECT role FROM utilisateurs WHERE id = $1', [req.params.id]);
  if (!cible[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (cible[0].role === 'admin') {
    const { rows: cnt } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM utilisateurs WHERE role = 'admin'");
    if (cnt[0].n <= 1)
      return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur' });
  }

  await pool.query('DELETE FROM utilisateurs WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
