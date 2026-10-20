const router = require('express').Router();
const { pool } = require('../db');
const { requireMaterielEditor } = require('../auth');
const ah = require('../ah');

// Lieux déjà utilisés (déduits des commandes) — sert au préremplissage du formulaire commande
router.get('/', ah(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (lower(adresse)) adresse, lieu_descriptif, contact_nom, contact_tel
    FROM commandes
    WHERE adresse IS NOT NULL AND adresse <> ''
    ORDER BY lower(adresse), date_event DESC, id DESC
  `);
  res.json(rows);
}));

// ---------- Annuaire structuré des lieux (fiches réutilisables) ----------
const clean = v => (v != null && String(v).trim() !== '') ? String(v).trim() : null;

router.get('/fiches', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.nom, l.adresse, l.description, l.photo, l.contact_nom, l.contact_tel,
            (SELECT COUNT(*) FROM lieu_photos lp WHERE lp.lieu_id = l.id) AS nb_photos
       FROM lieux l ORDER BY l.nom`);
  res.json(rows);
}));

router.post('/fiches', requireMaterielEditor, ah(async (req, res) => {
  const b = req.body || {};
  const nom = String(b.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const { rows } = await pool.query(
    'INSERT INTO lieux (nom, adresse, description, contact_nom, contact_tel) VALUES ($1,$2,$3,$4,$5) RETURNING id, nom, adresse, description, contact_nom, contact_tel',
    [nom, clean(b.adresse), clean(b.description), clean(b.contact_nom), clean(b.contact_tel)]);
  res.status(201).json(rows[0]);
}));

router.put('/fiches/:id', requireMaterielEditor, ah(async (req, res) => {
  const b = req.body || {};
  const nom = String(b.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const { rows } = await pool.query(
    'UPDATE lieux SET nom=$1, adresse=$2, description=$3, contact_nom=$4, contact_tel=$5 WHERE id=$6 RETURNING id, nom, adresse, description, contact_nom, contact_tel',
    [nom, clean(b.adresse), clean(b.description), clean(b.contact_nom), clean(b.contact_tel), req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Lieu introuvable' });
  res.json(rows[0]);
}));

router.delete('/fiches/:id', requireMaterielEditor, ah(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM lieux WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Lieu introuvable' });
  res.status(204).end();
}));

// Photo d'un lieu (base64, comme les autres entités)
const MAX_PHOTO = 3 * 1024 * 1024;
const PHOTO_RE = /^data:image\/(png|jpe?g|webp);base64,/;
router.get('/fiches/:id/photo', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT photo FROM lieux WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Lieu introuvable' });
  res.json({ photo: rows[0].photo || null });
}));
router.put('/fiches/:id/photo', requireMaterielEditor, ah(async (req, res) => {
  const photo = req.body && req.body.photo;
  if (photo && (typeof photo !== 'string' || !PHOTO_RE.test(photo) || photo.length > MAX_PHOTO))
    return res.status(400).json({ error: 'Image invalide (png/jpeg/webp, 3 Mo max)' });
  const { rows } = await pool.query('UPDATE lieux SET photo=$1 WHERE id=$2 RETURNING id', [photo || null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Lieu introuvable' });
  res.json({ ok: true });
}));

// Galerie : plusieurs photos par lieu
router.get('/fiches/:id/photos', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT id, photo FROM lieu_photos WHERE lieu_id=$1 ORDER BY position, id', [req.params.id]);
  res.json(rows);
}));
router.post('/fiches/:id/photos', requireMaterielEditor, ah(async (req, res) => {
  const photo = req.body && req.body.photo;
  if (typeof photo !== 'string' || !PHOTO_RE.test(photo) || photo.length > MAX_PHOTO)
    return res.status(400).json({ error: 'Image invalide (png/jpeg/webp, 3 Mo max)' });
  const { rows: l } = await pool.query('SELECT id FROM lieux WHERE id=$1', [req.params.id]);
  if (!l[0]) return res.status(404).json({ error: 'Lieu introuvable' });
  const { rows } = await pool.query(
    'INSERT INTO lieu_photos (lieu_id, photo, position) VALUES ($1,$2,COALESCE((SELECT MAX(position)+1 FROM lieu_photos WHERE lieu_id=$1),0)) RETURNING id',
    [req.params.id, photo]);
  res.status(201).json(rows[0]);
}));
router.delete('/fiches/:id/photos/:pid', requireMaterielEditor, ah(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM lieu_photos WHERE id=$1 AND lieu_id=$2', [req.params.pid, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Photo introuvable' });
  res.status(204).end();
}));

// Matériels présents / couverts sur place (ce lieu les rend inutiles → non envoyés)
router.get('/fiches/:id/sur-place', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sp.materiel_id, m.nom FROM lieu_sur_place sp JOIN materiels m ON m.id = sp.materiel_id
      WHERE sp.lieu_id = $1 ORDER BY m.nom`, [req.params.id]);
  res.json(rows);
}));
router.put('/fiches/:id/sur-place', requireMaterielEditor, ah(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.materiel_ids) ? req.body.materiel_ids.map(x => parseInt(x, 10)).filter(x => !Number.isNaN(x)) : [];
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query('DELETE FROM lieu_sur_place WHERE lieu_id = $1', [req.params.id]);
    for (const mid of ids)
      await cx.query('INSERT INTO lieu_sur_place (lieu_id, materiel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, mid]);
    await cx.query('COMMIT');
  } catch (e) { await cx.query('ROLLBACK'); throw e; } finally { cx.release(); }
  res.json({ ok: true });
}));

module.exports = router;
