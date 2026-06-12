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

// Réserve une route au rôle manager
function requireManager(req, res, next) {
  if (!req.user || req.user.role !== 'manager')
    return res.status(403).json({ error: 'Action réservée au manager' });
  next();
}

// Réserve une route à l'édition des recettes/ajustements (gérant ou chef)
function requireRecipeEditor(req, res, next) {
  if (!req.user || !['manager', 'chef'].includes(req.user.role))
    return res.status(403).json({ error: "Action réservée au gérant ou au chef" });
  next();
}

// Réserve une route à la gestion des comptes (admin ou gérant)
function requireAccountManager(req, res, next) {
  if (!req.user || !['admin', 'manager'].includes(req.user.role))
    return res.status(403).json({ error: "Action réservée à l'admin ou au gérant" });
  next();
}

module.exports = { hashPassword, comparePassword, signToken, authMiddleware, requireManager, requireRecipeEditor, requireAccountManager };
