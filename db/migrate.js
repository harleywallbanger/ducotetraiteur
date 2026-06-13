const { pool } = require('../src/db');
(async () => {
  try {
    await pool.query('ALTER TABLE commandes ADD COLUMN IF NOT EXISTS adresse text');
    await pool.query('ALTER TABLE commandes ADD COLUMN IF NOT EXISTS contact_nom text');
    await pool.query('ALTER TABLE commandes ADD COLUMN IF NOT EXISTS contact_tel text');
    console.log('✅ Colonnes adresse/contact prêtes.'); process.exit(0);
  } catch (e) { console.error('❌ Échec migration :', e.message); process.exit(1); }
})();
