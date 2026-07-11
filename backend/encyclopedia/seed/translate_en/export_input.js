const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

(async () => {
  const env = loadEnv(path.join(__dirname, '..', '.env'));
  const c = new Client({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD,
    database: env.DB_NAME || 'addiction_news',
  });
  await c.connect();
  const r = await c.query(
    `SELECT id, term_ko, term_en, category, definition,
            COALESCE(example,'') AS example, body, advanced
     FROM encyclopedia_terms ORDER BY id`,
  );
  const out = path.join(__dirname, 'translate_input.json');
  fs.writeFileSync(out, JSON.stringify(r.rows, null, 1), 'utf8');
  const beh = r.rows.filter((x) => x.category === 'behavioral');
  console.log('count', r.rows.length, 'behavioral', beh.length);
  console.log(beh.map((x) => x.id).join(','));
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
