const router = require('express').Router();
const { pool } = require('../db');
const ah = require('../ah');
router.get('/', ah(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (lower(client)) client, client_tel, client_email
    FROM commandes
    WHERE client IS NOT NULL AND client <> ''
    ORDER BY lower(client), date_event DESC, id DESC
  `);
  res.json(rows);
}));
module.exports = router;
