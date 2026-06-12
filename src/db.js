require('dotenv').config();
const { Pool, types } = require('pg');

types.setTypeParser(1082, v => v); // 1082 = type DATE → garder "AAAA-MM-JJ" tel quel

// Clever Cloud injecte POSTGRESQL_ADDON_URI ; on accepte les deux noms.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRESQL_ADDON_URI ||
  'postgres://postgres:postgres@localhost:5432/traiteur'; // défaut local

const pool = new Pool({ connectionString, max: 4 });

module.exports = { pool };
