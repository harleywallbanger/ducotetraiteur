const router = require('express').Router();
const { pool } = require('../db');
const { requireManager, requireIngredientEditor, requireMaterielEditor } = require('../auth');
const ah = require('../ah');

// ---------- INGRÉDIENTS ----------
router.get('/ingredients', ah(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM ingredients ORDER BY nom');
  res.json(rows);
}));

router.post('/ingredients', requireIngredientEditor, ah(async (req, res) => {
  const { nom, unite } = req.body || {};
  if (!nom || !unite) return res.status(400).json({ error: 'nom et unite requis' });
  const { rows } = await pool.query(
    'INSERT INTO ingredients (nom, unite) VALUES ($1, $2) RETURNING *', [nom, unite]);
  res.status(201).json(rows[0]);
}));

// ---------- MATÉRIEL (+ stock) ----------
router.get('/materiels', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT m.*, inv.quantite_stock, inv.seuil_alerte
       FROM materiels m
       LEFT JOIN inventaire inv ON inv.materiel_id = m.id
      ORDER BY m.nom`);
  res.json(rows);
}));

router.post('/materiels', requireMaterielEditor, ah(async (req, res) => {
  const { nom, unite, quantite_stock = 0, seuil_alerte = 0 } = req.body || {};
  if (!nom || !unite) return res.status(400).json({ error: 'nom et unite requis' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO materiels (nom, unite) VALUES ($1, $2) RETURNING *', [nom, unite]);
    await client.query(
      'INSERT INTO inventaire (materiel_id, quantite_stock, seuil_alerte) VALUES ($1, $2, $3)',
      [rows[0].id, quantite_stock, seuil_alerte]);
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], quantite_stock, seuil_alerte });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Mettre à jour le stock / seuil d'un matériel
router.put('/materiels/:id/inventaire', requireMaterielEditor, ah(async (req, res) => {
  const { quantite_stock, seuil_alerte } = req.body || {};
  if (quantite_stock == null || seuil_alerte == null)
    return res.status(400).json({ error: 'quantite_stock et seuil_alerte requis' });
  const { rows } = await pool.query(
    `INSERT INTO inventaire (materiel_id, quantite_stock, seuil_alerte)
     VALUES ($1, $2, $3)
     ON CONFLICT (materiel_id)
     DO UPDATE SET quantite_stock = EXCLUDED.quantite_stock, seuil_alerte = EXCLUDED.seuil_alerte
     RETURNING *`,
    [req.params.id, quantite_stock, seuil_alerte]);
  res.json(rows[0]);
}));

// ---------- INVENTAIRE & ALERTES ----------
router.get('/inventaire', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT inv.materiel_id, m.nom, m.unite, inv.quantite_stock, inv.seuil_alerte,
            (inv.quantite_stock < inv.seuil_alerte) AS en_alerte
       FROM inventaire inv
       JOIN materiels m ON m.id = inv.materiel_id
      ORDER BY m.nom`);
  res.json(rows);
}));

router.get('/alertes', ah(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM alertes_stock ORDER BY materiel');
  res.json(rows);
}));

module.exports = router;
