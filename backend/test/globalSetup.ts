import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

/** Recreates the test database from scratch and applies the schema (twice, to prove it is idempotent) */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const name = url.pathname.slice(1);
  // never touch a real database
  if (!/_test$/.test(name)) throw new Error(`Refusing to run tests against "${name}": the database name must end with _test`);

  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const schema = fs.readFileSync(path.resolve(__dirname, '../src/db/schema.sql'), 'utf8');
  await db.query(schema);
  await db.query(schema);
  await db.end();
}
