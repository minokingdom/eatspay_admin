const { createPool } = require('../db/pool');

async function main() {
  const pool = createPool();
  try {
    const providers = await pool.query(`
      SELECT name, status, note, display_order
      FROM pg_providers
      ORDER BY display_order, id
    `);
    const pgCounts = await pool.query(`
      SELECT pg, count(*)::int AS count
      FROM pg_settlements
      GROUP BY pg
      ORDER BY count DESC, pg
    `);
    const demo = await pool.query(`
      SELECT approval_no, pg, payment_amt, svc_fee, net_amt
      FROM pg_settlements
      WHERE approval_no LIKE 'DEMO-TX-%'
      ORDER BY approval_no
    `);
    console.log(JSON.stringify({
      providers: providers.rows,
      pgCounts: pgCounts.rows,
      demo: demo.rows
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
