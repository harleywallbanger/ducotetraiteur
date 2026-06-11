require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { authMiddleware } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

// Santé (public)
app.get('/health', (_req, res) => res.json({ ok: true }));

// Authentification (public)
app.use('/api/auth', require('./routes/auth'));

// Tout le reste exige un jeton valide
app.use('/api', authMiddleware);
app.use('/api/recettes',  require('./routes/recettes'));
app.use('/api/commandes', require('./routes/commandes'));
app.use('/api',           require('./routes/catalogue')); // /api/ingredients, /api/materiels, /api/inventaire, /api/alertes

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
app.listen(port, () => console.log(`API traiteur en écoute sur http://localhost:${port}`));
