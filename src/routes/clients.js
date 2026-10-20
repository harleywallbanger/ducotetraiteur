const router = require('express').Router();
const { pool } = require('../db');
const ah = require('../ah');
const { requireAccountManager } = require('../auth');
router.get('/', ah(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (lower(client)) client, client_tel, client_email
    FROM commandes
    WHERE client IS NOT NULL AND client <> ''
    ORDER BY lower(client), date_event DESC, id DESC
  `);
  res.json(rows);
}));
// Supprimer un client = supprimer toutes ses commandes (admin/gérant uniquement)
router.delete('/:nom', requireAccountManager, ah(async (req, res) => {
  const nom = String(req.params.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom de client requis' });
  const { rowCount } = await pool.query('DELETE FROM commandes WHERE lower(client) = lower($1)', [nom]);
  res.json({ deleted: rowCount });
}));
module.exports = router;
