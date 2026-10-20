const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ah = require('../ah');
const { requireMaterielEditor, requireManager } = require('../auth');

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

/* ---------- Matériel supplémentaire par commande ---------- */
router.get('/commandes/:id/materiels-extra', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cme.materiel_id, m.nom AS materiel, m.unite, cme.quantite
     FROM commande_materiels_extra cme
     JOIN materiels m ON m.id = cme.materiel_id
     WHERE cme.commande_id = $1
     ORDER BY m.nom`,
    [req.params.id]
  );
  res.json(rows);
}));

router.put('/commandes/:id/materiels-extra', requireMaterielEditor, ah(async (req, res) => {
  const cid = req.params.id;
  const lignes = Array.isArray(req.body.materiels) ? req.body.materiels : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM commande_materiels_extra WHERE commande_id = $1', [cid]);
    for (const l of lignes) {
      const mid = parseInt(l.materiel_id, 10);
      const q = parseInt(l.quantite, 10) || 0;
      if (Number.isNaN(mid) || q <= 0) continue;
      await client.query(
        `INSERT INTO commande_materiels_extra (commande_id, materiel_id, quantite)
         VALUES ($1, $2, $3)
         ON CONFLICT (commande_id, materiel_id) DO UPDATE SET quantite = EXCLUDED.quantite`,
        [cid, mid, q]
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

/* ---- Type de prestation (buffet / livré) sur une commande ---- */
router.put('/commandes/:id/type-prestation', requireManager, ah(async (req, res) => {
  const t = String((req.body && req.body.type_prestation) || '').trim();
  if (!['buffet', 'livre'].includes(t)) return res.status(400).json({ error: 'Type de prestation invalide' });
  const { rows } = await pool.query(
    'UPDATE commandes SET type_prestation = $1, modifie_par = $2 WHERE id = $3 RETURNING id, type_prestation',
    [t, req.user.nom || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(rows[0]);
}));

/* ---- Usage matériel (normal / jetable / les_deux) ---- */
router.get('/materiels-usage', ah(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, nom, COALESCE(usage_type, 'les_deux') AS usage_type FROM materiels ORDER BY nom"
  );
  res.json(rows);
}));

router.put('/materiels/:id/usage', requireMaterielEditor, ah(async (req, res) => {
  const u = String((req.body && req.body.usage_type) || '').trim();
  if (!['normal', 'jetable', 'les_deux'].includes(u)) return res.status(400).json({ error: 'Usage invalide' });
  const { rows } = await pool.query(
    'UPDATE materiels SET usage_type = $1 WHERE id = $2 RETURNING id, nom, usage_type',
    [u, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Matériel introuvable' });
  res.json(rows[0]);
}));
// "Reste sur place" : matériel durable (tables, gros matériel) chargé une fois pour tout l'événement
router.put('/materiels/:id/permanent', requireMaterielEditor, ah(async (req, res) => {
  const permanent = !!(req.body && req.body.permanent);
  const { rows } = await pool.query('UPDATE materiels SET permanent = $1 WHERE id = $2 RETURNING id, permanent', [permanent, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Matériel introuvable' });
  res.json(rows[0]);
}));

/* ---- Matériel laissé sur place : sortie / récupération ---- */

// État de sortie d'une commande
router.get('/commandes/:id/materiel-sortie', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.materiel_id, m.nom AS materiel, m.unite, s.quantite, s.sorti_le, s.recupere_le
       FROM commande_materiel_sortie s
       JOIN materiels m ON m.id = s.materiel_id
      WHERE s.commande_id = $1
      ORDER BY m.nom`, [req.params.id]);
  res.json(rows);
}));

// Déclarer le matériel sorti (fige les besoins effectifs du moment)
router.post('/commandes/:id/materiel-sortie', requireMaterielEditor, ah(async (req, res) => {
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO commande_materiel_sortie (commande_id, materiel_id, quantite, sorti_le, recupere_le)
         SELECT commande_id, materiel_id, quantite, CURRENT_DATE, NULL
           FROM besoins_materiel_effectif
          WHERE commande_id = $1 AND quantite > 0
       ON CONFLICT (commande_id, materiel_id)
         DO UPDATE SET quantite = EXCLUDED.quantite, sorti_le = CURRENT_DATE, recupere_le = NULL`, [id]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ ok: true });
}));

// Déclarer la récupération (retour de tout le matériel encore sorti)
router.post('/commandes/:id/materiel-recuperation', requireMaterielEditor, ah(async (req, res) => {
  await pool.query(
    `UPDATE commande_materiel_sortie SET recupere_le = CURRENT_DATE
      WHERE commande_id = $1 AND recupere_le IS NULL`, [req.params.id]);
  res.json({ ok: true });
}));

// Quantités actuellement sorties par matériel (pour le stock disponible)
router.get('/materiels-sorties', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT materiel_id, SUM(quantite) AS sorti
       FROM commande_materiel_sortie
      WHERE sorti_le IS NOT NULL AND recupere_le IS NULL
      GROUP BY materiel_id`);
  res.json(rows);
}));

/* ---- Location matériel : « à louer » pour couvrir le manque ---- */

// Locations d'une commande
router.get('/commandes/:id/materiel-location', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.materiel_id, m.nom AS materiel, m.unite, l.quantite, l.fournisseur
       FROM commande_materiel_location l
       JOIN materiels m ON m.id = l.materiel_id
      WHERE l.commande_id = $1
      ORDER BY m.nom`, [req.params.id]);
  res.json(rows);
}));

// Remplacer les locations d'une commande
router.put('/commandes/:id/materiel-location', requireMaterielEditor, ah(async (req, res) => {
  const id = req.params.id;
  const arr = Array.isArray(req.body && req.body.locations) ? req.body.locations : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM commande_materiel_location WHERE commande_id = $1', [id]);
    for (const l of arr) {
      const mid = Number(l.materiel_id);
      const q = Number(l.quantite) || 0;
      if (!mid || q <= 0) continue;
      const four = (l.fournisseur != null && String(l.fournisseur).trim() !== '') ? String(l.fournisseur).trim() : null;
      await client.query(
        `INSERT INTO commande_materiel_location (commande_id, materiel_id, quantite, fournisseur)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (commande_id, materiel_id) DO UPDATE SET quantite = EXCLUDED.quantite, fournisseur = EXCLUDED.fournisseur`,
        [id, mid, q, four]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ ok: true });
}));

/* ---- Transport : camions + attributs matériel + affectation commande ---- */

// Catalogue camions
router.get('/camions', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT id, nom, immatriculation, hayon, frigo, capacite, COALESCE(loue,false) AS loue, loueur FROM camions ORDER BY nom');
  res.json(rows);
}));
router.post('/camions', requireMaterielEditor, ah(async (req, res) => {
  const nom = String((req.body && req.body.nom) || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const hayon = !!(req.body && req.body.hayon);
  const frigo = !!(req.body && req.body.frigo);
  const capacite = (req.body && req.body.capacite != null && String(req.body.capacite).trim() !== '') ? String(req.body.capacite).trim() : null;
  const immatriculation = (req.body && req.body.immatriculation != null && String(req.body.immatriculation).trim() !== '') ? String(req.body.immatriculation).trim() : null;
  const loue = !!(req.body && req.body.loue);
  const loueur = (req.body && req.body.loueur != null && String(req.body.loueur).trim() !== '') ? String(req.body.loueur).trim() : null;
  const { rows } = await pool.query(
    'INSERT INTO camions (nom, immatriculation, hayon, frigo, capacite, loue, loueur) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nom, immatriculation, hayon, frigo, capacite, loue, loueur',
    [nom, immatriculation, hayon, frigo, capacite, loue, loueur]);
  res.status(201).json(rows[0]);
}));
router.put('/camions/:id', requireMaterielEditor, ah(async (req, res) => {
  const nom = String((req.body && req.body.nom) || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const hayon = !!(req.body && req.body.hayon);
  const frigo = !!(req.body && req.body.frigo);
  const capacite = (req.body && req.body.capacite != null && String(req.body.capacite).trim() !== '') ? String(req.body.capacite).trim() : null;
  const immatriculation = (req.body && req.body.immatriculation != null && String(req.body.immatriculation).trim() !== '') ? String(req.body.immatriculation).trim() : null;
  const loue = !!(req.body && req.body.loue);
  const loueur = (req.body && req.body.loueur != null && String(req.body.loueur).trim() !== '') ? String(req.body.loueur).trim() : null;
  const { rows } = await pool.query(
    'UPDATE camions SET nom=$1, immatriculation=$2, hayon=$3, frigo=$4, capacite=$5, loue=$6, loueur=$7 WHERE id=$8 RETURNING id, nom, immatriculation, hayon, frigo, capacite, loue, loueur',
    [nom, immatriculation, hayon, frigo, capacite, loue, loueur, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Camion introuvable' });
  res.json(rows[0]);
}));
router.delete('/camions/:id', requireMaterielEditor, ah(async (req, res) => {
  await pool.query('DELETE FROM camions WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

// Attributs transport du matériel (hayon/frigo requis)
router.get('/materiels-transport', ah(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nom, COALESCE(necessite_hayon,false) AS necessite_hayon, COALESCE(necessite_frigo,false) AS necessite_frigo FROM materiels ORDER BY nom');
  res.json(rows);
}));
router.put('/materiels/:id/transport', requireMaterielEditor, ah(async (req, res) => {
  const hayon = !!(req.body && req.body.necessite_hayon);
  const frigo = !!(req.body && req.body.necessite_frigo);
  const { rows } = await pool.query(
    'UPDATE materiels SET necessite_hayon=$1, necessite_frigo=$2 WHERE id=$3 RETURNING id, nom, necessite_hayon, necessite_frigo',
    [hayon, frigo, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Matériel introuvable' });
  res.json(rows[0]);
}));

// Affectation transport d'une commande
router.put('/commandes/:id/transport', requireMaterielEditor, ah(async (req, res) => {
  const camion_id = (req.body && req.body.camion_id) ? Number(req.body.camion_id) : null;
  const refrig = !!(req.body && req.body.transport_refrigere);
  const { rows } = await pool.query(
    'UPDATE commandes SET camion_id=$1, transport_refrigere=$2, modifie_par=$3 WHERE id=$4 RETURNING id',
    [camion_id, refrig, req.user.nom || null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable' });
  res.json({ ok: true });
}));
// État transport d'une commande + besoins calculés + alertes
router.get('/commandes/:id/transport', ah(async (req, res) => {
  const id = req.params.id;
  const { rows: cr } = await pool.query(
    'SELECT camion_id, COALESCE(transport_refrigere,false) AS transport_refrigere FROM commandes WHERE id=$1', [id]);
  if (!cr[0]) return res.status(404).json({ error: 'Commande introuvable' });
  let camion = null;
  if (cr[0].camion_id) {
    const { rows: c } = await pool.query('SELECT id, nom, hayon, frigo, capacite FROM camions WHERE id=$1', [cr[0].camion_id]);
    camion = c[0] || null;
  }
  const { rows: bes } = await pool.query(
    `SELECT COALESCE(bool_or(m.necessite_hayon),false) AS hayon_requis,
            COALESCE(bool_or(m.necessite_frigo),false) AS frigo_requis
       FROM besoins_materiel_effectif b JOIN materiels m ON m.id = b.materiel_id
      WHERE b.commande_id = $1`, [id]);
  const hayon_requis = bes[0] ? bes[0].hayon_requis === true : false;
  const frigo_requis = (bes[0] ? bes[0].frigo_requis === true : false) || cr[0].transport_refrigere === true;
  res.json({
    camion_id: cr[0].camion_id,
    transport_refrigere: cr[0].transport_refrigere === true,
    camion: camion,
    hayon_requis: hayon_requis,
    frigo_requis: frigo_requis,
    alerte_hayon: hayon_requis && !!camion && !camion.hayon,
    alerte_frigo: frigo_requis && !!camion && !camion.frigo
  });
}));

// Horaires d'une commande (départ marchandise/cuisinier, arrivée serveurs, retour)
router.put('/commandes/:id/horaires', requireMaterielEditor, ah(async (req, res) => {
  const b = req.body || {};
  const clean = (v) => (v != null && String(v).trim() !== '') ? String(v).trim() : null;
  const { rows } = await pool.query(
    `UPDATE commandes SET
        heure_debut              = $1,
        heure_depart_marchandise = $2,
        heure_depart_cuisinier   = $3,
        heure_arrivee_serveurs   = $4,
        heure_retour             = $5,
        modifie_par              = $6
      WHERE id = $7 RETURNING id`,
    [clean(b.heure_debut), clean(b.heure_depart_marchandise), clean(b.heure_depart_cuisinier), clean(b.heure_arrivee_serveurs), clean(b.heure_retour), req.user.nom || null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable' });
  res.json({ ok: true });
}));

// Commandes récentes/à venir avec date de dernière modification (pour la notification d'ouverture)
router.get('/commandes-modifs', ah(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, client, date_event, modifie_le, modifie_par FROM commandes WHERE date_event >= (CURRENT_DATE - INTERVAL '2 days') ORDER BY modifie_le DESC NULLS LAST LIMIT 60");
  res.json(rows);
}));

/* ---- Numéro de référence par matériel ---- */
router.get('/materiels-numeros', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT id, numero FROM materiels ORDER BY nom');
  res.json(rows);
}));
router.put('/materiels/:id/numero', requireMaterielEditor, ah(async (req, res) => {
  const numero = (req.body && req.body.numero != null && String(req.body.numero).trim() !== '') ? String(req.body.numero).trim() : null;
  const { rows } = await pool.query(
    'UPDATE materiels SET numero=$1 WHERE id=$2 RETURNING id, nom, numero',
    [numero, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Matériel introuvable' });
  res.json(rows[0]);
}));

/* ---- Photos (stockées en base, data URL) : matériel, boisson, camion ---- */
const TABLES_PHOTO = { materiels: 'materiels', boissons: 'boissons', camions: 'camions', recettes: 'recettes', personnel: 'personnel' };
const MAX_PHOTO = 3 * 1024 * 1024; // ~3 Mo de base64

function routePhoto(seg, table) {
  router.get(`/${seg}/:id/photo`, ah(async (req, res) => {
    const { rows } = await pool.query(`SELECT photo FROM ${table} WHERE id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json({ photo: rows[0].photo || null });
  }));
  router.put(`/${seg}/:id/photo`, requireMaterielEditor, ah(async (req, res) => {
    let photo = (req.body && req.body.photo != null && String(req.body.photo).trim() !== '') ? String(req.body.photo).trim() : null;
    if (photo && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(photo))
      return res.status(400).json({ error: 'Format image invalide' });
    if (photo && photo.length > MAX_PHOTO)
      return res.status(413).json({ error: 'Image trop lourde' });
    const { rows } = await pool.query(`UPDATE ${table} SET photo=$1 WHERE id=$2 RETURNING id`, [photo, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json({ ok: true });
  }));
}
for (const [seg, table] of Object.entries(TABLES_PHOTO)) routePhoto(seg, table);

/* ---- Annuaire du personnel ---- */
router.get('/personnel', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT id, nom, fonction, tel, COALESCE(actif,true) AS actif, photo FROM personnel ORDER BY nom');
  res.json(rows);
}));
router.post('/personnel', requireMaterielEditor, ah(async (req, res) => {
  const nom = String((req.body && req.body.nom) || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const fonction = (req.body && req.body.fonction != null && String(req.body.fonction).trim() !== '') ? String(req.body.fonction).trim() : null;
  const tel = (req.body && req.body.tel != null && String(req.body.tel).trim() !== '') ? String(req.body.tel).trim() : null;
  const { rows } = await pool.query(
    'INSERT INTO personnel (nom, fonction, tel) VALUES ($1,$2,$3) RETURNING id, nom, fonction, tel, actif',
    [nom, fonction, tel]);
  res.status(201).json(rows[0]);
}));
router.put('/personnel/:id', requireMaterielEditor, ah(async (req, res) => {
  const nom = String((req.body && req.body.nom) || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const fonction = (req.body && req.body.fonction != null && String(req.body.fonction).trim() !== '') ? String(req.body.fonction).trim() : null;
  const tel = (req.body && req.body.tel != null && String(req.body.tel).trim() !== '') ? String(req.body.tel).trim() : null;
  const actif = (req.body && req.body.actif != null) ? !!req.body.actif : true;
  const { rows } = await pool.query(
    'UPDATE personnel SET nom=$1, fonction=$2, tel=$3, actif=$4 WHERE id=$5 RETURNING id, nom, fonction, tel, actif',
    [nom, fonction, tel, actif, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Personne introuvable' });
  res.json(rows[0]);
}));
router.delete('/personnel/:id', requireMaterielEditor, ah(async (req, res) => {
  await pool.query('DELETE FROM personnel WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

/* ---- Fiche événement : bilan linge + remarques (boissons = conso auto) ---- */
router.put('/commandes/:id/bilan', requireMaterielEditor, ah(async (req, res) => {
  const clean = (v) => (v != null && String(v).trim() !== '') ? String(v).trim() : null;
  const { rows } = await pool.query(
    'UPDATE commandes SET bilan_linge=$1, remarques_event=$2, modifie_par=$3 WHERE id=$4 RETURNING id',
    [clean(req.body && req.body.bilan_linge), clean(req.body && req.body.remarques_event), req.user.nom || null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable' });
  res.json({ ok: true });
}));

/* ---- Suivi du jour J : jalons (cuisine / matériel / camion / parti) ---- */
const JALONS = ['cuisine', 'materiel', 'camion', 'parti'];
router.get('/commandes/:id/jalons', ah(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT jalon, fait, fait_le, fait_par FROM commande_jalons WHERE commande_id = $1', [req.params.id]);
  const map = {};
  rows.forEach(r => { map[r.jalon] = r; });
  res.json(JALONS.map(j => map[j] || { jalon: j, fait: false, fait_le: null, fait_par: null }));
}));
router.put('/commandes/:id/jalons/:jalon', ah(async (req, res) => {
  const jalon = String(req.params.jalon || '');
  if (!JALONS.includes(jalon)) return res.status(400).json({ error: 'Jalon inconnu' });
  const fait = !!(req.body && req.body.fait);
  const { rows } = await pool.query(
    `INSERT INTO commande_jalons (commande_id, jalon, fait, fait_le, fait_par)
       VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END, CASE WHEN $3 THEN $4 ELSE NULL END)
     ON CONFLICT (commande_id, jalon) DO UPDATE SET
       fait = EXCLUDED.fait,
       fait_le = CASE WHEN EXCLUDED.fait THEN now() ELSE NULL END,
       fait_par = CASE WHEN EXCLUDED.fait THEN $4 ELSE NULL END
     RETURNING jalon, fait, fait_le, fait_par`,
    [req.params.id, jalon, fait, req.user.nom || null]);
  res.json(rows[0]);
}));

/* ---- Anticipation des approvisionnements (boissons à commander + linge à prévoir) ---- */
router.get('/appros', ah(async (req, res) => {
  const from = (req.query.from && String(req.query.from)) || new Date().toISOString().slice(0, 10);
  const to = (req.query.to && String(req.query.to)) || null;
  const params = [from];
  let dateCond = 'c.date_event >= $1';
  if (to) { params.push(to); dateCond += ' AND c.date_event <= $2'; }

  // Boissons : somme des sorties planifiées (pas encore retournées) vs stock
  const { rows: boissons } = await pool.query(
    `SELECT b.id, b.nom, b.unite, b.stock,
            SUM(cb.sortie) AS besoin,
            MIN(c.date_event) AS echeance,
            COUNT(DISTINCT c.id) AS nb_commandes
       FROM commande_boissons cb
       JOIN commandes c ON c.id = cb.commande_id
       JOIN boissons b ON b.id = cb.boisson_id
      WHERE ${dateCond} AND cb.retour IS NULL AND cb.sortie > 0
      GROUP BY b.id, b.nom, b.unite, b.stock
     HAVING SUM(cb.sortie) > 0
      ORDER BY b.nom`, params);

  // Linge : besoins effectifs des matériels de type linge (repérés par nom) vs stock
  const { rows: linge } = await pool.query(
    `SELECT e.materiel_id, e.materiel AS nom, e.unite,
            MAX(e.stock) AS stock,
            SUM(e.quantite) AS besoin,
            MIN(c.date_event) AS echeance,
            COUNT(DISTINCT c.id) AS nb_commandes
       FROM besoins_materiel_effectif e
       JOIN commandes c ON c.id = e.commande_id
      WHERE ${dateCond}
        AND (e.materiel ILIKE '%nappe%' OR e.materiel ILIKE '%serviette%'
          OR e.materiel ILIKE '%torchon%' OR e.materiel ILIKE '%housse%'
          OR e.materiel ILIKE '%nappage%' OR e.materiel ILIKE '%linge%')
      GROUP BY e.materiel_id, e.materiel, e.unite
     HAVING SUM(e.quantite) > 0
      ORDER BY e.materiel`, params);

  const enrich = r => {
    const besoin = Number(r.besoin) || 0, stock = Number(r.stock) || 0;
    return { ...r, besoin, stock, a_prevoir: Math.max(besoin - stock, 0) };
  };
  res.json({ from, to, boissons: boissons.map(enrich), linge: linge.map(enrich) });
}));

/* ---- Structure multi-jour : journées d'une commande (date, libellé, horaires, notes) ---- */
router.get('/commandes/:id/jours', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, jour_index, jour_date, label, heure_depart_marchandise, heure_depart_cuisinier,
            heure_arrivee_serveurs, heure_retour, notes
       FROM commande_jours WHERE commande_id = $1 ORDER BY jour_index, jour_date`, [req.params.id]);
  res.json(rows);
}));
router.put('/commandes/:id/jours', requireMaterielEditor, ah(async (req, res) => {
  const jours = Array.isArray(req.body && req.body.jours) ? req.body.jours : [];
  const t = v => (v != null && String(v).trim() !== '') ? String(v).trim() : null;
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query('DELETE FROM commande_jours WHERE commande_id = $1', [req.params.id]);
    let i = 0;
    for (const j of jours) {
      i++;
      await cx.query(
        `INSERT INTO commande_jours (commande_id, jour_index, jour_date, label,
            heure_depart_marchandise, heure_depart_cuisinier, heure_arrivee_serveurs, heure_retour, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.params.id, Number(j.jour_index) || i, t(j.jour_date), t(j.label),
         t(j.heure_depart_marchandise), t(j.heure_depart_cuisinier), t(j.heure_arrivee_serveurs), t(j.heure_retour), t(j.notes)]);
    }
    await cx.query('COMMIT');
  } catch (e) { await cx.query('ROLLBACK'); throw e; } finally { cx.release(); }
  res.json({ ok: true });
}));

/* ---- Préparation : cases cochées par article (matériel / cuisine / boisson) ---- */
router.get('/commandes/:id/coches', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT categorie, ref_id FROM commande_coche WHERE commande_id = $1', [req.params.id]);
  res.json(rows);
}));
router.put('/commandes/:id/coche', ah(async (req, res) => {
  const b = req.body || {};
  const cat = String(b.categorie || '');
  const ref = parseInt(b.ref_id, 10);
  if (!['materiel', 'cuisine', 'boisson'].includes(cat) || Number.isNaN(ref))
    return res.status(400).json({ error: 'categorie/ref_id invalide' });
  if (b.coche) {
    await pool.query(
      `INSERT INTO commande_coche (commande_id, categorie, ref_id, coche_par) VALUES ($1,$2,$3,$4)
       ON CONFLICT (commande_id, categorie, ref_id) DO UPDATE SET coche_par = EXCLUDED.coche_par, coche_le = now()`,
      [req.params.id, cat, ref, req.user.nom || null]);
  } else {
    await pool.query('DELETE FROM commande_coche WHERE commande_id=$1 AND categorie=$2 AND ref_id=$3', [req.params.id, cat, ref]);
  }
  res.json({ ok: true });
}));

module.exports = router;
