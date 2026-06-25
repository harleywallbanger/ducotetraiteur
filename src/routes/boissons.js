const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ah = require('../ah');
const { requireMaterielEditor } = require('../auth');

/* ---------- Catalogue boissons ---------- */
router.get('/boissons', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT id, nom, unite, stock FROM boissons ORDER BY nom');
  res.json(rows);
}));

router.post('/boissons', requireMaterielEditor, ah(async (req, res) => {
  const nom = (req.body.nom || '').trim();
  const unite = ((req.body.unite || '').trim()) || 'pièce';
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const { rows } = await pool.query(
    `INSERT INTO boissons (nom, unite) VALUES ($1, $2)
     ON CONFLICT (nom) DO UPDATE SET unite = EXCLUDED.unite
     RETURNING id, nom, unite, stock`,
    [nom, unite]
  );
  res.json(rows[0]);
}));

router.put('/boissons/:id/stock', requireMaterielEditor, ah(async (req, res) => {
  const q = parseInt(req.body.stock, 10);
  if (Number.isNaN(q)) return res.status(400).json({ error: 'Stock invalide' });
  const { rows } = await pool.query(
    'UPDATE boissons SET stock = $1 WHERE id = $2 RETURNING id, nom, unite, stock',
    [q, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Boisson introuvable' });
  res.json(rows[0]);
}));

/* ---------- Lignes boissons d'une commande ---------- */
router.get('/commandes/:id/boissons', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cb.boisson_id, b.nom, b.unite, b.stock, cb.sortie, cb.retour
     FROM commande_boissons cb
     JOIN boissons b ON b.id = cb.boisson_id
     WHERE cb.commande_id = $1
     ORDER BY b.nom`,
    [req.params.id]
  );
  const out = rows.map(r => ({
    ...r,
    conso: (r.retour == null ? null : Math.max(0, (r.sortie || 0) - (r.retour || 0)))
  }));
  res.json(out);
}));

/* Enregistrer les SORTIES (sans toucher aux retours déjà saisis) */
router.put('/commandes/:id/boissons', requireMaterielEditor, ah(async (req, res) => {
  const cid = req.params.id;
  const lignes = Array.isArray(req.body.boissons) ? req.body.boissons : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keep = [];
    for (const l of lignes) {
      const bid = parseInt(l.boisson_id, 10);
      const sortie = parseInt(l.sortie, 10) || 0;
      if (Number.isNaN(bid)) continue;
      keep.push(bid);
      await client.query(
        `INSERT INTO commande_boissons (commande_id, boisson_id, sortie)
         VALUES ($1, $2, $3)
         ON CONFLICT (commande_id, boisson_id)
         DO UPDATE SET sortie = EXCLUDED.sortie
         WHERE commande_boissons.retour IS NULL`,
        [cid, bid, sortie]
      );
    }
    // Retire les lignes décochées (uniquement celles sans retour saisi)
    if (keep.length) {
      await client.query(
        `DELETE FROM commande_boissons
         WHERE commande_id = $1 AND retour IS NULL AND boisson_id <> ALL($2::int[])`,
        [cid, keep]
      );
    } else {
      await client.query(
        `DELETE FROM commande_boissons WHERE commande_id = $1 AND retour IS NULL`,
        [cid]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

/* Saisir les RETOURS J+1 → décrément du stock par delta de conso (idempotent) */
router.put('/commandes/:id/boissons/retour', requireMaterielEditor, ah(async (req, res) => {
  const cid = req.params.id;
  const lignes = Array.isArray(req.body.boissons) ? req.body.boissons : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const l of lignes) {
      const bid = parseInt(l.boisson_id, 10);
      if (Number.isNaN(bid)) continue;
      const raw = l.retour;
      const retour = (raw === '' || raw == null) ? null : (parseInt(raw, 10) || 0);
      const { rows } = await client.query(
        'SELECT sortie, conso_applique FROM commande_boissons WHERE commande_id = $1 AND boisson_id = $2',
        [cid, bid]
      );
      if (!rows.length) continue;
      const sortie = rows[0].sortie || 0;
      const prevConso = rows[0].conso_applique; // null si jamais appliqué
      if (retour == null) {
        // Annulation : on restitue au stock ce qui avait été décrémenté
        if (prevConso != null) {
          await client.query('UPDATE boissons SET stock = stock + $1 WHERE id = $2', [prevConso, bid]);
        }
        await client.query(
          'UPDATE commande_boissons SET retour = NULL, conso_applique = NULL WHERE commande_id = $1 AND boisson_id = $2',
          [cid, bid]
        );
      } else {
        const newConso = Math.max(0, sortie - retour);
        const delta = newConso - (prevConso == null ? 0 : prevConso);
        if (delta !== 0) {
          await client.query('UPDATE boissons SET stock = stock - $1 WHERE id = $2', [delta, bid]);
        }
        await client.query(
          'UPDATE commande_boissons SET retour = $1, conso_applique = $2 WHERE commande_id = $3 AND boisson_id = $4',
          [retour, newConso, cid, bid]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

module.exports = router;
