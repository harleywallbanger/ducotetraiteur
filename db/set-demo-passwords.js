// Rotation des mots de passe des comptes de démo — NON destructeur.
//   Usage (depuis le dossier backend, DATABASE_URL pointant vers la base CIBLE) :
//       export DATABASE_URL="postgres://…"   # ou POSTGRESQL_ADDON_URI
//       node db/set-demo-passwords.js
//
//   - Génère un mot de passe aléatoire fort pour chaque compte.
//   - Met à jour la colonne mot_de_passe (hash bcrypt) via UPDATE ciblé.
//   - N'exécute AUCUN DROP / CREATE : la base et ses données restent intactes.
//   - Affiche les nouveaux identifiants UNE SEULE FOIS (dans ce terminal).
//
//   ⚠️ Ne jamais committer les mots de passe affichés ; note-les dans ton
//      gestionnaire de secrets, pas dans le dépôt.

const crypto = require('crypto');
const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth');

// Comptes à régénérer (emails inchangés, seuls les mots de passe changent)
const COMPTES = [
  { email: 'marc@traiteur.fr', role: 'manager' },
  { email: 'paul@traiteur.fr', role: 'preparateur' },
];

// Mot de passe aléatoire URL-safe (~24 caractères, sans ambiguïté de copier-coller)
const genPassword = () => crypto.randomBytes(18).toString('base64url');

(async () => {
  try {
    const resultats = [];
    for (const c of COMPTES) {
      const clair = genPassword();
      const hash  = await hashPassword(clair);
      const { rowCount } = await pool.query(
        'UPDATE utilisateurs SET mot_de_passe = $1 WHERE email = $2',
        [hash, c.email]
      );
      if (rowCount === 0) {
        console.error(`⚠️  Aucun compte trouvé pour ${c.email} — rien mis à jour.`);
      } else {
        resultats.push({ ...c, clair });
      }
    }

    if (resultats.length) {
      console.log('\n✅ Mots de passe régénérés (à noter MAINTENANT, hors du dépôt) :\n');
      for (const r of resultats) {
        console.log(`   ${r.role.padEnd(12)} ${r.email.padEnd(20)} ${r.clair}`);
      }
      console.log('\n   (Ces valeurs ne seront plus affichées.)');
    }
    process.exit(0);
  } catch (e) {
    console.error('❌ Échec de la rotation :', e.message);
    process.exit(1);
  }
})();
