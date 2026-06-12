const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth');
(async () => {
  const nom = process.env.ADMIN_NOM, email = process.env.ADMIN_EMAIL, pwd = process.env.ADMIN_PASSWORD;
  const manq = [];
  if (!nom) manq.push('ADMIN_NOM'); if (!email) manq.push('ADMIN_EMAIL'); if (!pwd) manq.push('ADMIN_PASSWORD');
  if (manq.length) { console.error('❌ Variables manquantes : ' + manq.join(', ')); process.exit(1); }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('❌ Email invalide.'); process.exit(1); }
  if (pwd.length < 12 || pwd === 'choisis-un-mot-de-passe-fort') { console.error("❌ Mot de passe trop faible (≥ 12 caractères, pas la valeur d'exemple)."); process.exit(1); }
  try {
    await pool.query("ALTER TYPE role_utilisateur ADD VALUE IF NOT EXISTS 'admin'");
    await pool.query("ALTER TYPE role_utilisateur ADD VALUE IF NOT EXISTS 'chef'");
    await pool.query("ALTER TYPE role_utilisateur ADD VALUE IF NOT EXISTS 'cuisinier'");
    await pool.query('ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS bloque BOOLEAN NOT NULL DEFAULT false');
    const hash = await hashPassword(pwd);
    await pool.query(
      `INSERT INTO utilisateurs (nom, email, mot_de_passe, role) VALUES ($1,$2,$3,'admin')
       ON CONFLICT (email) DO UPDATE SET nom=EXCLUDED.nom, mot_de_passe=EXCLUDED.mot_de_passe, role='admin', bloque=false`,
      [nom, email, hash]);
    console.log('✅ Administrateur prêt :', email); process.exit(0);
  } catch (e) { console.error('❌ Échec :', e.message); process.exit(1); }
})();
