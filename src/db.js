require('dotenv').config();
const { Pool, types } = require('pg');

types.setTypeParser(1082, v => v); // 1082 = type DATE → garder "AAAA-MM-JJ" tel quel

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/traiteur',
});

module.exports = { pool };
