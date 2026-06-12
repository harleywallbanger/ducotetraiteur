// Création / mise à jour d'un compte administrateur (rôle manager) — NON destructeur.
//   Usage (depuis le dossier backend, DATABASE_URL pointant vers la base CIBLE) :
//       export DATABASE_URL="postgres://…"          # ou POSTGRESQL_ADDON_URI
//       ADMIN_NOM="Prénom Nom" \
//       ADMIN_EMAIL="admin@exemple.fr" \
//       ADMIN_PASSWORD="un-mot-de-passe-fort" \
//       npm run create-admin
//
//   - Crée le compte s'il n'existe pas, sinon met à jour (nom, mot de passe, rôle manager).
//   - Hash bcrypt ; le mot de passe n'est JAMAIS affiché ni journalisé.
//   - N'exécute AUCUN DROP / CREATE : la base et ses données restent intactes.

const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth');

const nom   = (process.env.ADMIN_NOM      || '').trim();
const email = (process.env.ADMIN_EMAIL    || '').trim().toLowerCase();
const pass  =  process.env.ADMIN_PASSWORD || '';

// Validations garde-fou
const erreurs = [];
if (!nom)   erreurs.push('ADMIN_NOM manquant');
if (!email) erreurs.push('ADMIN_EMAIL manquant');
else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erreurs.push('ADMIN_EMAIL invalide');
if (!pass)  erreurs.push('ADMIN_PASSWORD manquant');
else if (pass.length < 12) erreurs.push('ADMIN_PASSWORD trop court (≥ 12 caractères)');
else if (pass === 'choisis-un-mot-de-passe-fort') erreurs.push('ADMIN_PASSWORD est encore la valeur d\'exemple — choisis-en un vrai');

if (erreurs.length) {
  console.error('❌ Paramètres invalides :');
  for (const e of erreurs) console.error('   - ' + e);
  console.error('\nExemple :\n   ADMIN_NOM="Prénom Nom" ADMIN_EMAIL="admin@exemple.fr" ADMIN_PASSWORD="********" npm run create-admin');
  process.exit(1);
}

(async () => {
  try {
    const hash = await hashPassword(pass);
    const { rows } = await pool.query(
      `INSERT INTO utilisateurs (nom, email, mot_de_passe, role)
         VALUES ($1, $2, $3, 'manager')
       ON CONFLICT (email) DO UPDATE
         SET nom = EXCLUDED.nom,
             mot_de_passe = EXCLUDED.mot_de_passe,
             role = 'manager'
       RETURNING id, (xmax = 0) AS cree`,
      [nom, email, hash]
    );
    const { id, cree } = rows[0];
    console.log(`\n✅ Compte administrateur ${cree ? 'créé' : 'mis à jour'} (rôle manager).`);
    console.log(`   id    : ${id}`);
    console.log(`   nom   : ${nom}`);
    console.log(`   email : ${email}`);
    console.log('\n   (Le mot de passe n\'est pas affiché — note-le dans ton gestionnaire de secrets.)');
    process.exit(0);
  } catch (e) {
    console.error('❌ Échec de la création de l\'admin :', e.message);
    process.exit(1);
  }
})();
