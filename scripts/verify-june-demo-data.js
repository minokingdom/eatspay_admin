const { createPool } = require('../db/pool');

async function main() {
  const pool = createPool();
  try {
    const result = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM users WHERE email LIKE 'junedemo-%@eatspay.local') AS users,
        (SELECT count(*)::int FROM users WHERE email LIKE 'junedemo-%@eatspay.local' AND role = 'OWNER') AS approved_users,
        (SELECT count(*)::int FROM users WHERE email LIKE 'junedemo-%@eatspay.local' AND role = 'OWNER_PENDING') AS pending_users,
        (SELECT count(*)::int FROM users WHERE email LIKE 'junedemo-%@eatspay.local' AND role = 'OWNER_REJECTED') AS rejected_users,
        (SELECT count(*)::int FROM cards WHERE id LIKE 'JUNEDEMO-CARD-%') AS cards,
        (SELECT count(*)::int FROM account_requests WHERE request_id LIKE 'JUNEDEMO-REQ-%') AS account_requests,
        (SELECT count(*)::int FROM delivery_accounts WHERE account_no LIKE 'JUNEDEMO-%') AS delivery_accounts,
        (SELECT count(*)::int FROM transactions WHERE transaction_id LIKE 'JUNEDEMO-TX-%') AS transactions,
        (SELECT COALESCE(sum(total_amount), 0)::int FROM transactions WHERE transaction_id LIKE 'JUNEDEMO-TX-%' AND status = 'SUCCESS') AS success_total_amount,
        (SELECT count(*)::int FROM pg_settlements WHERE pg_tx_id LIKE 'PG-JUNEDEMO-%') AS pg_settlements,
        (SELECT count(*)::int FROM notifications WHERE data->>'seed' = 'JUNEDEMO') AS notifications
    `);
    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
