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
    `SELECT c.id, c.client, c.date_event, c.couverts, c.notes,
            COALESCE(s.statut, 'ok') AS statut,
            (SELECT COALESCE(SUM(nb_personnes), 0) FROM commande_recettes cr WHERE cr.commande_id = c.id) AS total_couverts,
            (SELECT COUNT(*) FROM commande_jalons cj WHERE cj.commande_id = c.id AND cj.fait) AS jalons_faits
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
    `SELECT cr.recette_id, r.nom, r.allergenes, r.allergenes_libre, cr.nb_personnes
       FROM commande_recettes cr JOIN recettes r ON r.id = cr.recette_id
      WHERE cr.commande_id = $1 ORDER BY r.nom`, [id]);

  const { rows: materiel } = await pool.query(
    'SELECT * FROM besoins_materiel_effectif WHERE commande_id = $1 ORDER BY materiel', [id]);

  const { rows: cuisine } = await pool.query(
    'SELECT * FROM besoins_ingredients_effectif WHERE commande_id = $1 ORDER BY ingredient', [id]);

  const { rows: st } = await pool.query(
    'SELECT statut FROM commande_statut WHERE commande_id = $1', [id]);

  // Règle "tireuse à bière fournie par le lieu" : si le lieu a une tireuse à bière,
  // on retire la tireuse des besoins — sauf si elle a été ajoutée/ajustée manuellement.
  let lieuDesc = c[0].lieu_descriptif || '';
  if (c[0].lieu_id) {
    const { rows: lr } = await pool.query('SELECT description FROM lieux WHERE id = $1', [c[0].lieu_id]);
    if (lr[0] && lr[0].description) lieuDesc += ' ' + lr[0].description;
  }
  const lieuHasTap = /tireuse/i.test(lieuDesc) && /bi[èe]re/i.test(lieuDesc);
  let materielOut = materiel, tireuse_lieu = null;
  if (lieuHasTap) {
    const exclus = [];
    materielOut = materiel.filter(m => {
      if (/tireuse/i.test(m.materiel || '') && !m.ajuste && !m.extra) { exclus.push(m.materiel); return false; }
      return true;
    });
    tireuse_lieu = { present: true, exclus };
  }

  res.json({ ...c[0], statut: st[0]?.statut || 'ok', lignes, materiel: materielOut, cuisine, tireuse_lieu });
}));

// Créer une commande
router.post('/', requireManager, ah(async (req, res) => {
  const { client: clientNom, client_tel = null, client_email = null, date_event, couverts = null, notes = null, adresse = null, lieu_descriptif = null, contact_nom = null, contact_tel = null, lieu_id = null, lignes = [] } = req.body || {};
  if (!date_event || !lignes.length)
    return res.status(400).json({ error: 'date_event et au moins une recette requis' });
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const { rows } = await cx.query(
      'INSERT INTO commandes (client, client_tel, client_email, date_event, couverts, notes, adresse, lieu_descriptif, contact_nom, contact_tel, lieu_id, cree_par, modifie_par) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [clientNom, client_tel, client_email, date_event, couverts, notes, adresse, lieu_descriptif, contact_nom, contact_tel, lieu_id || null, req.user.id, req.user.nom || null]);
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
  const { client: clientNom, client_tel = null, client_email = null, date_event, couverts = null, notes = null, adresse = null, lieu_descriptif = null, contact_nom = null, contact_tel = null, lieu_id = null, lignes } = req.body || {};
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const { rows } = await cx.query(
      'UPDATE commandes SET client=$1, client_tel=$2, client_email=$3, date_event=$4, couverts=$5, notes=$6, adresse=$7, lieu_descriptif=$8, contact_nom=$9, contact_tel=$10, lieu_id=$11, modifie_par=$12 WHERE id=$13 RETURNING *',
      [clientNom, client_tel, client_email, date_event, couverts, notes, adresse, lieu_descriptif, contact_nom, contact_tel, lieu_id || null, req.user.nom || null, req.params.id]);
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
