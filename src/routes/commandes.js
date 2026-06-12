const router = require('express').Router();
const { pool } = require('../db');
const { requireManager, requireRecipeEditor } = require('../auth');
const ah = require('../ah');

// Liste des commandes (pour le calendrier), filtrable par période ?from=&to=
router.get('/', ah(async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  const conds = [];
  if (from) { params.push(from); conds.push(`c.date_event >= $${params.length}`); }
  if (to)   { params.push(to);   conds.push(`c.date_event <= $${params.length}`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const { rows } = await pool.query(
    `SELECT c.id, c.client, c.date_event, c.notes,
            COALESCE(s.statut, 'ok') AS statut,
            (SELECT COALESCE(SUM(nb_personnes), 0) FROM commande_recettes cr WHERE cr.commande_id = c.id) AS total_couverts
       FROM commandes c
       LEFT JOIN commande_statut s ON s.commande_id = c.id
       ${where}
      ORDER BY c.date_event`, params);
  res.json(rows);
}));

// Détail d'une commande : recettes + besoins matériel/cuisine effectifs + statut
router.get('/:id', ah(async (req, res) => {
  const id = req.params.id;
  const { rows: c } = await pool.query('SELECT * FROM commandes WHERE id = $1', [id]);
  if (!c[0]) return res.status(404).json({ error: 'Commande introuvable' });

  const { rows: lignes } = await pool.query(
    `SELECT cr.recette_id, r.nom, cr.nb_personnes
       FROM commande_recettes cr JOIN recettes r ON r.id = cr.recette_id
      WHERE cr.commande_id = $1 ORDER BY r.nom`, [id]);

  const { rows: materiel } = await pool.query(
    'SELECT * FROM besoins_materiel_effectif WHERE commande_id = $1 ORDER BY materiel', [id]);

  const { rows: cuisine } = await pool.query(
    'SELECT * FROM besoins_ingredients_effectif WHERE commande_id = $1 ORDER BY ingredient', [id]);

  const { rows: st } = await pool.query(
    'SELECT statut FROM commande_statut WHERE commande_id = $1', [id]);

  res.json({ ...c[0], statut: st[0]?.statut || 'ok', lignes, materiel, cuisine });
}));

// Créer une commande
router.post('/', requireManager, ah(async (req, res) => {
  const { client: clientNom, date_event, notes = null, lignes = [] } = req.body || {};
  if (!date_event || !lignes.length)
    return res.status(400).json({ error: 'date_event et au moins une recette requis' });
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const { rows } = await cx.query(
      'INSERT INTO commandes (client, date_event, notes, cree_par) VALUES ($1, $2, $3, $4) RETURNING *',
      [clientNom, date_event, notes, req.user.id]);
    for (const l of lignes)
      await cx.query(
        'INSERT INTO commande_recettes (commande_id, recette_id, nb_personnes) VALUES ($1, $2, $3)',
        [rows[0].id, l.recette_id, l.nb_personnes]);
    await cx.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await cx.query('ROLLBACK');
    throw e;
  } finally {
    cx.release();
  }
}));

// Modifier l'en-tête + les recettes d'une commande
router.put('/:id', requireManager, ah(async (req, res) => {
  const { client: clientNom, date_event, notes = null, lignes } = req.body || {};
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const { rows } = await cx.query(
      'UPDATE commandes SET client = $1, date_event = $2, notes = $3 WHERE id = $4 RETURNING *',
      [clientNom, date_event, notes, req.params.id]);
    if (!rows[0]) { await cx.query('ROLLBACK'); return res.status(404).json({ error: 'Commande introuvable' }); }
    if (Array.isArray(lignes)) {
      await cx.query('DELETE FROM commande_recettes WHERE commande_id = $1', [req.params.id]);
      for (const l of lignes)
        await cx.query(
          'INSERT INTO commande_recettes (commande_id, recette_id, nb_personnes) VALUES ($1, $2, $3)',
          [req.params.id, l.recette_id, l.nb_personnes]);
    }
    await cx.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await cx.query('ROLLBACK');
    throw e;
  } finally {
    cx.release();
  }
}));

// Supprimer une commande
router.delete('/:id', requireManager, ah(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM commandes WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Commande introuvable' });
  res.status(204).end();
}));

// ----- Ajustements manuels (override d'une quantité OU ajout d'un extra) -----
// Matériel
router.put('/:id/materiel/:materielId', requireRecipeEditor, ah(async (req, res) => {
  const { quantite } = req.body || {};
  if (quantite == null) return res.status(400).json({ error: 'quantite requise' });
  await pool.query(
    `INSERT INTO commande_materiels_ajust (commande_id, materiel_id, quantite)
     VALUES ($1, $2, $3)
     ON CONFLICT (commande_id, materiel_id) DO UPDATE SET quantite = EXCLUDED.quantite`,
    [req.params.id, req.params.materielId, quantite]);
  res.json({ ok: true });
}));

// Retirer l'ajustement (retour au calcul auto, ou suppression de l'extra)
router.delete('/:id/materiel/:materielId', requireRecipeEditor, ah(async (req, res) => {
  await pool.query(
    'DELETE FROM commande_materiels_ajust WHERE commande_id = $1 AND materiel_id = $2',
    [req.params.id, req.params.materielId]);
  res.status(204).end();
}));

// Cuisine
router.put('/:id/cuisine/:ingredientId', requireRecipeEditor, ah(async (req, res) => {
  const { quantite } = req.body || {};
  if (quantite == null) return res.status(400).json({ error: 'quantite requise' });
  await pool.query(
    `INSERT INTO commande_ingredients_ajust (commande_id, ingredient_id, quantite)
     VALUES ($1, $2, $3)
     ON CONFLICT (commande_id, ingredient_id) DO UPDATE SET quantite = EXCLUDED.quantite`,
    [req.params.id, req.params.ingredientId, quantite]);
  res.json({ ok: true });
}));

router.delete('/:id/cuisine/:ingredientId', requireRecipeEditor, ah(async (req, res) => {
  await pool.query(
    'DELETE FROM commande_ingredients_ajust WHERE commande_id = $1 AND ingredient_id = $2',
    [req.params.id, req.params.ingredientId]);
  res.status(204).end();
}));

module.exports = router;
