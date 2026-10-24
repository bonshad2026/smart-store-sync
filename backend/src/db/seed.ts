import fs from 'fs';
import path from 'path';
import { pool } from './pool';
import { migrate } from './migrate';
import { importCsv } from '../services/csvImport';

// Loads sample-data/products.csv into the database (for demo / testing)
async function main() {
  await migrate();
  const file = path.resolve(__dirname, '../../../sample-data/products.csv');
  const result = await importCsv(fs.readFileSync(file), 'seed');
  console.log('✔ Seed finished:', result);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
