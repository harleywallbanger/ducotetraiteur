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
    'SELECT id, nom, adresse, description, photo, contact_nom, contact_tel FROM lieux ORDER BY nom');
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

module.exports = router;
