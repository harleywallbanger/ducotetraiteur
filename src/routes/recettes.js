const router = require('express').Router();
const { pool } = require('../db');
const { requireRecipeEditor } = require('../auth');
const ah = require('../ah');

// Liste des recettes
router.get('/', ah(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM recettes ORDER BY nom');
  res.json(rows);
}));

// Détail d'une recette (avec ingrédients et matériel)
router.get('/:id', ah(async (req, res) => {
  const { rows: r } = await pool.query('SELECT * FROM recettes WHERE id = $1', [req.params.id]);
  if (!r[0]) return res.status(404).json({ error: 'Recette introuvable' });

  const { rows: ingredients } = await pool.query(
    `SELECT ri.ingredient_id, i.nom, i.unite, ri.quantite
       FROM recette_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recette_id = $1 ORDER BY i.nom`, [req.params.id]);

  const { rows: materiels } = await pool.query(
    `SELECT rm.materiel_id, m.nom, m.unite, rm.mode, rm.quantite, rm.capacite
       FROM recette_materiels rm
       JOIN materiels m ON m.id = rm.materiel_id
      WHERE rm.recette_id = $1 ORDER BY m.nom`, [req.params.id]);

  res.json({ ...r[0], ingredients, materiels });
}));

// Insère les lignes ingrédient + matériel d'une recette (réutilisé en create/update)
async function insertLignes(client, recetteId, ingredients = [], materiels = []) {
  for (const ing of ingredients)
    await client.query(
      'INSERT INTO recette_ingredients (recette_id, ingredient_id, quantite) VALUES ($1, $2, $3)',
      [recetteId, ing.ingredient_id, ing.quantite]);
  for (const m of materiels) {
    const mode = m.mode === 'par_palier' ? 'par_palier' : 'proportionnel';
    const capacite = mode === 'par_palier' ? m.capacite : null;
    await client.query(
      'INSERT INTO recette_materiels (recette_id, materiel_id, mode, quantite, capacite) VALUES ($1, $2, $3, $4, $5)',
      [recetteId, m.materiel_id, mode, m.quantite, capacite]);
  }
}

// Créer une recette
router.post('/', requireRecipeEditor, ah(async (req, res) => {
  const { nom, description = null, portion_base = 10, ingredients = [], materiels = [] } = req.body || {};
  if (!nom) return res.status(400).json({ error: 'nom requis' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO recettes (nom, description, portion_base) VALUES ($1, $2, $3) RETURNING *',
      [nom, description, portion_base]);
    await insertLignes(client, rows[0].id, ingredients, materiels);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Modifier une recette (remplace ses lignes)
router.put('/:id', requireRecipeEditor, ah(async (req, res) => {
  const { nom, description = null, portion_base = 10, ingredients = [], materiels = [] } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE recettes SET nom = $1, description = $2, portion_base = $3 WHERE id = $4 RETURNING *',
      [nom, description, portion_base, req.params.id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Recette introuvable' }); }
    await client.query('DELETE FROM recette_ingredients WHERE recette_id = $1', [req.params.id]);
    await client.query('DELETE FROM recette_materiels  WHERE recette_id = $1', [req.params.id]);
    await insertLignes(client, req.params.id, ingredients, materiels);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Supprimer une recette
router.delete('/:id', requireRecipeEditor, ah(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM recettes WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Recette introuvable' });
  res.status(204).end();
}));

module.exports = router;
