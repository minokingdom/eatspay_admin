const { createPool } = require('../db/pool');

async function main() {
  const pool = createPool();
  try {
    const pg = await pool.query(`
      SELECT count(*)::int AS count,
             COALESCE(sum(payment_amt), 0)::bigint AS payment_amt,
             COALESCE(sum(svc_fee), 0)::bigint AS svc_fee,
             COALESCE(sum(net_amt), 0)::bigint AS net_amt
      FROM pg_settlements
      WHERE status <> 'ROLLED_BACK'
    `);
    const agency = await pool.query(`
      SELECT s.agency_id,
             COALESCE(a.name, s.agency_name, '-') AS agency_name,
             COALESCE(a.fee_rate, 0)::numeric AS fee_rate,
             count(*)::int AS count,
             COALESCE(sum(s.payment_amt), 0)::bigint AS payment_amt,
             COALESCE(sum(s.svc_fee), 0)::bigint AS svc_fee,
             COALESCE(sum(s.net_amt), 0)::bigint AS net_amt,
             COALESCE(sum(floor(s.net_amt * COALESCE(a.fee_rate, 0) / 100)), 0)::bigint AS agency_fee,
             COALESCE(sum(s.net_amt - floor(s.net_amt * COALESCE(a.fee_rate, 0) / 100)), 0)::bigint AS agency_net
      FROM pg_settlements s
      LEFT JOIN agencies a ON a.id = s.agency_id
      WHERE s.status <> 'ROLLED_BACK'
      GROUP BY s.agency_id, COALESCE(a.name, s.agency_name, '-'), COALESCE(a.fee_rate, 0)
      ORDER BY net_amt DESC
    `);
    const agencySum = agency.rows.reduce((acc, row) => {
      acc.count += Number(row.count || 0);
      acc.payment_amt += Number(row.payment_amt || 0);
      acc.svc_fee += Number(row.svc_fee || 0);
      acc.net_amt += Number(row.net_amt || 0);
      return acc;
    }, { count: 0, payment_amt: 0, svc_fee: 0, net_amt: 0 });

    console.log(JSON.stringify({
      pg: pg.rows[0],
      agencySum,
      match: {
        count: Number(pg.rows[0].count) === agencySum.count,
        payment_amt: Number(pg.rows[0].payment_amt) === agencySum.payment_amt,
        svc_fee: Number(pg.rows[0].svc_fee) === agencySum.svc_fee,
        net_amt: Number(pg.rows[0].net_amt) === agencySum.net_amt
      },
      agencies: agency.rows
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
