const { createPool } = require('../db/pool');

const POSTS = [
  ['치킨 배달용기 나눔합니다', '사용하지 않은 소형 치킨 박스 80장 정도 있습니다. 가까운 가맹점이면 직접 전달 가능합니다.', 0, 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=600&q=80'],
  ['업소용 45박스 냉장고 저렴하게 드립니다', '매장 이전으로 냉장고 정리합니다. 정상 작동하고 직접 가져가실 분 찾습니다.', 180000, 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=600&q=80'],
  ['포스 영수증 롤지 공동구매하실 분', '영수증 롤지 박스 단위로 같이 구매하면 단가가 내려가서 함께하실 가맹점 찾습니다.', 32000, 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=600&q=80'],
  ['배달대행사 추천 부탁드립니다', '저녁 피크 타임에 배차가 늦어서 근처에서 안정적인 대행사 추천 부탁드립니다.', 0, ''],
  ['테이블 4개와 의자 정리합니다', '매장 리뉴얼로 테이블 4개, 의자 12개 정리합니다. 상태는 깨끗한 편입니다.', 120000, 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80'],
  ['미사용 포장 봉투 판매합니다', '로고 없는 크라프트 포장 봉투 500장입니다. 반값에 드립니다.', 25000, 'https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=600&q=80'],
  ['주방 선반 가져가실 분', '스테인리스 3단 선반입니다. 직접 가져가시면 무료 나눔합니다.', 0, 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=600&q=80'],
  ['근처 가맹점과 쿠폰 제휴 원합니다', '같은 상권 가맹점끼리 배달 쿠폰 교차 홍보하실 분 연락 주세요.', 0, '']
];

async function main() {
  const pool = createPool();
  try {
    const existing = await pool.query("SELECT count(*)::int AS count FROM talk_posts WHERE status = 'ACTIVE'");
    if (Number(existing.rows[0]?.count || 0) > 0) {
      console.log('Talk demo seed skipped: existing posts found.');
      return;
    }

    const users = await pool.query(`
      SELECT id, franchise_id, franchise_name
      FROM users
      WHERE role = 'OWNER'
      ORDER BY created_at DESC
      LIMIT 8
    `);
    if (!users.rows.length) {
      console.log('Talk demo seed skipped: no approved franchise users.');
      return;
    }

    for (let i = 0; i < POSTS.length; i += 1) {
      const user = users.rows[i % users.rows.length];
      const [title, body, price, imageUrl] = POSTS[i];
      await pool.query(
        `INSERT INTO talk_posts (
           user_id, franchise_id, franchise_name, title, body, price, image_url, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), now() - ($8::int * interval '3 hours'), now() - ($8::int * interval '3 hours'))`,
        [
          user.id,
          user.franchise_id,
          user.franchise_name || '이츠페이 가맹점',
          title,
          body,
          price,
          imageUrl,
          i
        ]
      );
    }
    console.log(`Talk demo seed inserted: ${POSTS.length} posts.`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
