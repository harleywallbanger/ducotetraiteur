const router = require('express').Router();
const { pool } = require('../db');
const ah = require('../ah');
router.get('/', ah(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (lower(adresse)) adresse, lieu_descriptif, contact_nom, contact_tel
    FROM commandes
    WHERE adresse IS NOT NULL AND adresse <> ''
    ORDER BY lower(adresse), date_event DESC, id DESC
  `);
  res.json(rows);
}));
module.exports = router;
