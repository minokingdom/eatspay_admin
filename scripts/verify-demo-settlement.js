const { createPool } = require('../db/pool');

async function main() {
  const pool = createPool();
  try {
    const rows = await pool.query(`
      SELECT t.transaction_id,
             t.amount AS tx_amount,
             t.fee AS tx_fee,
             t.total_amount AS tx_total,
             s.payment_amt AS pg_payment,
             s.svc_fee AS pg_fee,
             s.net_amt AS pg_net,
             s.pg,
             s.franchise_name,
             s.agency_name
      FROM transactions t
      JOIN pg_settlements s ON s.approval_no = t.transaction_id
      WHERE t.transaction_id LIKE 'DEMO-TX-%'
      ORDER BY t.transaction_id
    `);
    const mismatch = await pool.query(`
      SELECT count(*)::int AS bad
      FROM transactions t
      JOIN pg_settlements s ON s.approval_no = t.transaction_id
      WHERE t.transaction_id LIKE 'DEMO-TX-%'
        AND (t.amount <> s.net_amt OR t.fee <> s.svc_fee OR t.total_amount <> s.payment_amt)
    `);
    const missingPg = await pool.query(`
      SELECT count(*)::int AS missing
      FROM transactions t
      LEFT JOIN pg_settlements s ON s.approval_no = t.transaction_id
      WHERE t.transaction_id LIKE 'DEMO-TX-%'
        AND s.id IS NULL
    `);
    console.log(JSON.stringify({
      count: rows.rowCount,
      mismatch: mismatch.rows[0].bad,
      missingPg: missingPg.rows[0].missing,
      rows: rows.rows
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
