require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET manquant — refus de démarrer');

const hashPassword    = (clair)      => bcrypt.hash(clair, 10);
const comparePassword = (clair, hash) => bcrypt.compare(clair, hash);

const signToken = (u) =>
  jwt.sign({ id: u.id, role: u.role, nom: u.nom }, SECRET, { expiresIn: '12h' });

// Vérifie le jeton et place l'utilisateur sur req.user
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Jeton invalide ou expiré' });
  }
}

// Accès "complet sauf Administration" : gérant, maître d'hôtel, serveur
const PLEIN_ACCES = ['manager', 'maitre_hotel', 'serveur'];

// Réserve une route au rôle gérant (et maître d'hôtel / serveur)
function requireManager(req, res, next) {
  if (!req.user || !PLEIN_ACCES.includes(req.user.role))
    return res.status(403).json({ error: 'Action réservée au gérant' });
  next();
}

// Réserve une route à l'édition des recettes/ajustements (gérant, chef, maître d'hôtel, serveur)
function requireRecipeEditor(req, res, next) {
  if (!req.user || !['admin', 'manager', 'chef', 'maitre_hotel', 'serveur'].includes(req.user.role))
    return res.status(403).json({ error: "Action réservée au gérant ou au chef" });
  next();
}

// Réserve une route à la gestion des comptes (admin ou gérant uniquement — Administration)
function requireAccountManager(req, res, next) {
  if (!req.user || !['admin', 'manager'].includes(req.user.role))
    return res.status(403).json({ error: "Action réservée à l'admin ou au gérant" });
  next();
}

function requireIngredientEditor(req, res, next) {
  const r = req.user && req.user.role;
  if (['admin', 'manager', 'chef', 'maitre_hotel', 'serveur'].includes(r)) return next();
  return res.status(403).json({ error: 'Accès réservé' });
}
function requireMaterielEditor(req, res, next) {
  const r = req.user && req.user.role;
  if (['admin', 'manager', 'preparateur', 'maitre_hotel', 'serveur'].includes(r)) return next();
  return res.status(403).json({ error: 'Accès réservé' });
}

module.exports = { hashPassword, comparePassword, signToken, authMiddleware, requireManager, requireRecipeEditor, requireAccountManager, requireIngredientEditor, requireMaterielEditor };
