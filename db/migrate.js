const { pool } = require('../src/db');
(async () => {
  try {
    await pool.query('ALTER TABLE commandes ADD COLUMN IF NOT EXISTS adresse text');
    await pool.query('ALTER TABLE commandes ADD COLUMN IF NOT EXISTS lieu_descriptif text');
    await pool.query('ALTER TABLE commandes ADD COLUMN IF NOT EXISTS contact_nom text');
    await pool.query('ALTER TABLE commandes ADD COLUMN IF NOT EXISTS contact_tel text');
    console.log('✅ Colonnes adresse/lieu_descriptif/contact prêtes.'); process.exit(0);
  } catch (e) { console.error('❌ Échec migration :', e.message); process.exit(1); }
})();
