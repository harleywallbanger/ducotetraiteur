const router = require('express').Router();
const { pool } = require('../db');
const { requireAccountManager, hashPassword } = require('../auth');
const ah = require('../ah');

const ROLES = ['admin', 'manager', 'chef', 'cuisinier', 'preparateur'];

// Toutes les routes de gestion des comptes sont réservées à l'admin ou au gérant
router.use(requireAccountManager);

// Liste des utilisateurs (sans le mot de passe)
router.get('/', ah(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nom, email, role, bloque, cree_le FROM utilisateurs ORDER BY nom');
  res.json(rows);
}));

// Créer un utilisateur
router.post('/', ah(async (req, res) => {
  const { nom, email, mot_de_passe, role } = req.body || {};
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
  res.status(201).json(rows[0]);
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
