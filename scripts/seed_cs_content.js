const fs = require('fs');
const path = require('path');

const { createPool } = require('../db/pool');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  const root = process.argv[2] || process.cwd();
  const faqs = readJson(path.join(root, 'eatspay-faq-seed.json'));
  const notices = readJson(path.join(root, 'eatspay-notices-seed.json'));
  const guides = readJson(path.join(root, 'eatspay-guides-seed.json'));
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM faqs');
    await client.query("DELETE FROM board_posts WHERE board_type IN ('notices', 'guides')");

    for (const item of faqs) {
      await client.query(
        `INSERT INTO faqs (category, question, answer, active, display_order)
         VALUES ($1, $2, $3, true, $4)`,
        [item.category, item.question, item.answer, Number(item.displayOrder || 0)]
      );
    }

    for (const item of notices) {
      await client.query(
        `INSERT INTO board_posts (board_type, title, author, content, active)
         VALUES ('notices', $1, $2, $3, true)`,
        [item.title, item.author || '운영팀', item.content]
      );
    }

    for (const item of guides) {
      await client.query(
        `INSERT INTO board_posts (board_type, title, author, content, active)
         VALUES ('guides', $1, $2, $3, true)`,
        [item.title, item.author || 'CS팀', item.content]
      );
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      success: true,
      faqs: faqs.length,
      notices: notices.length,
      guides: guides.length
    }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
