const router = require('express').Router();
const { pool } = require('../db');
const { comparePassword, signToken } = require('../auth');
const ah = require('../ah');

// POST /api/auth/login
router.post('/login', ah(async (req, res) => {
  const { email, mot_de_passe } = req.body || {};
  if (!email || !mot_de_passe)
    return res.status(400).json({ error: 'email et mot_de_passe requis' });

  const { rows } = await pool.query('SELECT * FROM utilisateurs WHERE email = $1', [email]);
  const u = rows[0];
  if (!u || !(await comparePassword(mot_de_passe, u.mot_de_passe)))
    return res.status(401).json({ error: 'Identifiants incorrects' });

  res.json({
    token: signToken(u),
    utilisateur: { id: u.id, nom: u.nom, email: u.email, role: u.role },
  });
}));

module.exports = router;
