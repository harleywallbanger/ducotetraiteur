require('dotenv').config();
const { Pool, types } = require('pg');

types.setTypeParser(1082, v => v); // 1082 = type DATE → garder "AAAA-MM-JJ" tel quel

// Clever Cloud injecte POSTGRESQL_ADDON_URI ; on accepte les deux noms.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRESQL_ADDON_URI ||
  'postgres://postgres:postgres@localhost:5432/traiteur'; // défaut local

// Plan dédié XXS (45 connexions dispo) → pool remonté (était 4 sous le plan DEV / 5 connexions)
const pool = new Pool({ connectionString, max: 10 });

module.exports = { pool };
