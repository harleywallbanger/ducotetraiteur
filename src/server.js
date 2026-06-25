require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { authMiddleware } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

// Page d'accueil + fichiers statiques (public/index.html servi sur GET /)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Santé (public)
app.get('/health', (_req, res) => res.json({ ok: true }));

// Authentification (public)
app.use('/api/auth', require('./routes/auth'));

// Tout le reste exige un jeton valide
app.use('/api', authMiddleware);
app.use('/api/utilisateurs', require('./routes/utilisateurs'));
app.use('/api/recettes',  require('./routes/recettes'));
app.use('/api/commandes', require('./routes/commandes'));
app.use('/api/lieux',     require('./routes/lieux'));
app.use('/api/clients',   require('./routes/clients'));
app.use('/api',           require('./routes/catalogue')); // /api/ingredients, /api/materiels, /api/inventaire, /api/alertes
app.use('/api',           require('./routes/boissons'));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route inconnue' }));

// Gestion centralisée des erreurs (dont contraintes PostgreSQL)
app.use((err, _req, res, _next) => {
  if (err.code === '23505') return res.status(409).json({ error: 'Doublon : cet enregistrement existe déjà' });
  if (err.code === '23503') return res.status(409).json({ error: 'Référence existante : opération impossible' });
  if (err.code === '23514') return res.status(400).json({ error: 'Valeur invalide (contrainte non respectée)' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const port = process.env.PORT || 8080;
const { pool: _migPool } = require('./db');
(async () => {
  for (const sql of [
    'ALTER TABLE commandes ADD COLUMN IF NOT EXISTS adresse text',
    'ALTER TABLE commandes ADD COLUMN IF NOT EXISTS lieu_descriptif text',
    'ALTER TABLE commandes ADD COLUMN IF NOT EXISTS contact_nom text',
    'ALTER TABLE commandes ADD COLUMN IF NOT EXISTS contact_tel text',
    'ALTER TABLE commandes ADD COLUMN IF NOT EXISTS couverts integer',
    'ALTER TABLE commandes ADD COLUMN IF NOT EXISTS client_tel text',
    'ALTER TABLE commandes ADD COLUMN IF NOT EXISTS client_email text',
    'ALTER TABLE recettes ADD COLUMN IF NOT EXISTS allergenes text',
    'ALTER TABLE recettes ADD COLUMN IF NOT EXISTS allergenes_libre text',
    "CREATE TABLE IF NOT EXISTS boissons (id SERIAL PRIMARY KEY, nom TEXT UNIQUE NOT NULL, unite TEXT, stock INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS commande_boissons (commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE, boisson_id INTEGER NOT NULL REFERENCES boissons(id) ON DELETE CASCADE, sortie INTEGER DEFAULT 0, retour INTEGER, conso_applique INTEGER, PRIMARY KEY (commande_id, boisson_id))",
    "CREATE TABLE IF NOT EXISTS commande_materiels_extra (commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE, materiel_id INTEGER NOT NULL REFERENCES materiels(id) ON DELETE CASCADE, quantite INTEGER DEFAULT 0, PRIMARY KEY (commande_id, materiel_id))",
      "ALTER TYPE mode_echelle ADD VALUE IF NOT EXISTS 'par_couvert'",
      "ALTER TABLE recette_materiels DROP CONSTRAINT IF EXISTS capacite_coherente",
      "ALTER TABLE recette_materiels ADD CONSTRAINT capacite_coherente CHECK ((mode = 'par_palier' AND capacite IS NOT NULL) OR (mode IN ('proportionnel','par_couvert') AND capacite IS NULL))",
      "ALTER TABLE commandes ADD COLUMN IF NOT EXISTS type_prestation TEXT DEFAULT 'buffet'",
      "ALTER TABLE materiels ADD COLUMN IF NOT EXISTS usage_type TEXT DEFAULT 'les_deux'",
      `CREATE OR REPLACE VIEW besoins_materiel_commande AS SELECT cr.commande_id, rm.materiel_id, m.nom AS materiel, m.unite, SUM(CASE rm.mode WHEN 'proportionnel' THEN rm.quantite * cr.nb_personnes::NUMERIC / r.portion_base WHEN 'par_palier' THEN CEIL(cr.nb_personnes::NUMERIC / rm.capacite) * rm.quantite ELSE 0 END) + COALESCE(MAX(CASE WHEN rm.mode = 'par_couvert' THEN rm.quantite * COALESCE(co.couverts, cr.nb_personnes)::NUMERIC END), 0) AS quantite_totale FROM commande_recettes cr JOIN commandes co ON co.id = cr.commande_id JOIN recettes r ON r.id = cr.recette_id JOIN recette_materiels rm ON rm.recette_id = r.id JOIN materiels m ON m.id = rm.materiel_id WHERE (COALESCE(co.type_prestation,'buffet') = 'buffet' AND COALESCE(m.usage_type,'les_deux') IN ('normal','les_deux')) OR (COALESCE(co.type_prestation,'buffet') = 'livre' AND COALESCE(m.usage_type,'les_deux') IN ('jetable','les_deux')) GROUP BY cr.commande_id, rm.materiel_id, m.nom, m.unite`,
  ]) {
    try { await _migPool.query(sql); }
    catch (e) { console.error('Migration colonne:', e.message); }
  }
  console.log('Migration colonnes commandes : terminee');
  try { await require('./seed-catalog')(_migPool); } catch (e) { console.error('Seed:', e.message); }
  app.listen(port, '0.0.0.0', () => {
    console.log(`API traiteur en écoute sur le port ${port}`);
  });
})();
