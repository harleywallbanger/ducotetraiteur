// Réinitialise la base : schéma, données d'exemple, et deux utilisateurs de démo.
//   node db/init.js   (ou : npm run init-db)
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth');

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const seed   = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');

    console.log('→ Création du schéma…');
    await pool.query(schema);

    console.log('→ Insertion des données d\'exemple…');
    await pool.query(seed);

    console.log('→ Création des utilisateurs de démo…');
    const [mgr, prep] = await Promise.all([hashPassword('manager123'), hashPassword('prepa123')]);
    await pool.query(
      `INSERT INTO utilisateurs (nom, email, mot_de_passe, role) VALUES
         ('Marc Manager',      'marc@traiteur.fr', $1, 'manager'),
         ('Paul Préparateur',  'paul@traiteur.fr', $2, 'preparateur')`,
      [mgr, prep]
    );

    console.log('\n✅ Base initialisée.');
    console.log('   Manager      : marc@traiteur.fr / manager123');
    console.log('   Préparateur  : paul@traiteur.fr / prepa123');
    process.exit(0);
  } catch (e) {
    console.error('❌ Échec de l\'initialisation :', e.message);
    process.exit(1);
  }
})();
