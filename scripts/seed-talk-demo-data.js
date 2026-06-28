const fs = require('fs');
const path = require('path');
const { createPool } = require('../db/pool');

const rootDir = path.join(__dirname, '..');
const uploadDir = path.join(rootDir, 'uploads');
const realImageNames = [
  '1781807566150-de51f046-bb56-4444-b7c4-10b2ba5d26b1.jpg',
  '1781708561527-79ff8eb2-ae57-49e6-80c6-1db2e6596130.png',
  '1781765510074-8ae339ba-51cf-4be1-94db-9e4834d27d6a.jpg',
  '1781831842076-a4429000-6da1-4332-b577-361d40c229ea.png',
  '1781766869803-8ef07b56-98e2-4702-a894-c66367ec3314.jpg',
  '1781867719831-903ed16d-d301-466a-84f7-30fc740e32a2.jpg',
  '1781839528167-6b07ed84-c41b-40e9-ae38-8617c07d911c.png',
  '1781765246689-51a51343-8c80-4a20-a78c-12a3f696832e.png',
  '1781831380014-15d220bf-b964-4a0c-85eb-1c50dc3e2e4b.jpg',
  '1781768578369-1506a3df-1517-40f7-9176-234e1cf7a3ab.jpg',
  '1781848056148-afd17771-90e2-43ce-ac43-1904c1de3c3b.png',
  '1781842215819-bf1d22f2-7189-404f-baf9-dbf2c34d48e8.jpg',
  '1781768060124-af9d6082-42af-43aa-9bff-b188e80a1147.jpg',
  '1781866401217-0cf5ff6e-e518-4e4d-8979-f9afa177f135.jpg',
  '1781768023746-f49c1559-9568-45c4-a186-119bac8c0334.jpg',
  '1781866935346-0227fcfe-5eb3-469b-8fef-b70d4073ba84.jpg',
  '1781801496375-3ae72a99-5456-4e43-a28d-b273acd12256.jpg',
  '1781843853893-66e4cf88-4510-4fdb-82fe-807570a9d19d.jpg',
  '1781767651131-26c9b80b-bbd0-474d-bb6b-3d2a04d5802a.jpg',
  '1781723836761-0c78f65d-bd8f-4aaf-a898-5cf49c2659d9.png',
  '1781767604169-0c9c51c8-699d-4333-8771-d84bcad55b85.jpg',
  '1782003510147-9fe638b4-edf0-47d4-8f77-007b92fd12ae.png',
  '1781769864508-3f17b6e9-62ea-40ce-950c-b51b32635ded.jpg',
  '1781710477587-a1f9dff9-e925-43ea-a45a-181db9cd3ef5.png',
  '1781753246488-abdca76a-6123-45ec-8371-8a4767029c91.png',
  '1781804665701-6d3127f6-33cf-4fb9-9877-2507ecf44389.jpg',
  '1781766931469-b4be3cae-abc8-442b-a3d9-83c9ea6eb1ea.jpg',
  '1781805934209-903e879c-7953-494b-8085-78f263ec7ff9.jpg',
  '1781867855466-71b18828-7128-4060-b514-3d2776d332d1.jpg',
  '1781767603139-1c46d1ca-33b5-480b-a405-98c1bccb3e70.jpg'
];

const posts = [
  ['인천 구월동', '포스 거치대 나눔합니다', '매장 정리하면서 남은 포스 거치대입니다. 바로 가져가실 분이면 좋겠습니다.', 0, '인천광역시 남동구 구월동 1457'],
  ['인천 송도', '영수증 프린터 판매', '정상 출력 확인했습니다. 여분 롤지 2개 같이 드립니다.', 45000, '인천광역시 연수구 송도동 24-5'],
  ['인천 청라', '배달 보온가방 2개', '사용감 조금 있지만 지퍼와 내부 상태 좋습니다.', 18000, '인천광역시 서구 청라동 162-22'],
  ['부평역', '카운터용 태블릿 거치대', '카운터에서 주문앱 띄워두기 좋은 각도 조절 거치대입니다.', 12000, '인천광역시 부평구 부평동 738-21'],
  ['계양 작전동', '주방 타이머 일괄', '주방에서 쓰던 디지털 타이머 4개 일괄입니다.', 9000, '인천광역시 계양구 작전동 907-1'],
  ['서울 강남', '카드단말기 받침대', '단말기 받침대와 케이블 정리 클립 같이 드립니다.', 15000, '서울특별시 강남구 역삼동 737'],
  ['서울 마포', '배달 스티커 롤', '봉투 밀봉용 스티커 롤입니다. 거의 새 상품입니다.', 7000, '서울특별시 마포구 서교동 395-43'],
  ['서울 영등포', '메뉴판 아크릴 꽂이', 'A4 세로형 아크릴 꽂이 6개입니다.', 16000, '서울특별시 영등포구 여의도동 23'],
  ['서울 성수', '카페 진동벨 세트', '번호표 10개, 충전기 포함입니다. 테스트 완료했습니다.', 60000, '서울특별시 성동구 성수동2가 289-5'],
  ['서울 잠실', '포장 용기 소량 나눔', '남은 포장 용기와 뚜껑입니다. 수량 확인 후 가져가세요.', 0, '서울특별시 송파구 잠실동 40-1'],
  ['김포 장기동', '배달가방 대형', '대형 보온가방입니다. 피자 박스도 들어갑니다.', 25000, '경기도 김포시 장기동 2001-1'],
  ['부천 상동', '주문 확인용 중고폰', '와이파이로 주문앱 확인용으로 사용했습니다.', 35000, '경기도 부천시 원미구 상동 544-4'],
  ['시흥 배곧', '카운터 미니 선풍기', '카운터 열기 식히는 용도로 사용했습니다.', 8000, '경기도 시흥시 배곧동 245'],
  ['안산 중앙동', '영업중 LED 안내판', '작동 정상입니다. 어댑터 포함입니다.', 22000, '경기도 안산시 단원구 고잔동 541'],
  ['광명 철산', '주방 선반 정리함', '작은 소스통이나 비품 정리에 좋습니다.', 10000, '경기도 광명시 철산동 261'],
  ['수원 인계동', '포스 영수증 용지', '58mm 감열지 20롤입니다.', 17000, '경기도 수원시 팔달구 인계동 1113'],
  ['성남 분당', '매장용 블루투스 스피커', '작동 정상, 충전 케이블 포함입니다.', 28000, '경기도 성남시 분당구 정자동 178-1'],
  ['용인 수지', '대기번호 안내판', '소형 화이트보드 안내판입니다.', 11000, '경기도 용인시 수지구 풍덕천동 1080-1'],
  ['고양 일산', '음료 캐리어 잔여분', '4구 음료 캐리어 약 150개 남았습니다.', 13000, '경기도 고양시 일산동구 장항동 868'],
  ['파주 운정', '포장 봉투 묶음', '무지 포장봉투 중형 사이즈입니다.', 9000, '경기도 파주시 와동동 1412'],
  ['의정부 민락', '카운터 계산 트레이', '결제대 앞 트레이로 쓰기 좋습니다.', 6000, '경기도 의정부시 민락동 804'],
  ['남양주 다산', '냉장 쇼케이스 소품', '가격표 꽂이와 라벨 홀더 일괄입니다.', 14000, '경기도 남양주시 다산동 6176'],
  ['하남 미사', '배달 호출벨', '호출벨 수신기와 버튼 3개 세트입니다.', 39000, '경기도 하남시 망월동 1079'],
  ['화성 동탄', '카드 영수증 보관함', '카운터에서 쓰던 영수증 보관함입니다.', 7000, '경기도 화성시 반송동 93-1'],
  ['평택 고덕', '매장 청소도구 걸이', '벽부착형 도구 걸이입니다. 미사용품입니다.', 10000, '경기도 평택시 고덕동 1694'],
  ['천안 불당', '주문 메모 패드', '주문 메모 패드와 펜꽂이 같이 드립니다.', 5000, '충청남도 천안시 서북구 불당동 1485'],
  ['아산 배방', '배달 포장 스티커', '감사 문구 스티커 500매 정도 남았습니다.', 6000, '충청남도 아산시 배방읍 장재리 1755'],
  ['청주 오송', '소형 전자저울', '소스 계량용으로 썼습니다. 정상 작동합니다.', 19000, '충청북도 청주시 흥덕구 오송읍 만수리 533'],
  ['충주 연수동', '오토바이 휴대폰 거치대', '배달용 거치대입니다. 고정 상태 좋습니다.', 12000, '충청북도 충주시 연수동 1619'],
  ['대전 둔산', '매장 안내 POP 세트', '가격 안내 POP와 받침대 일괄입니다.', 15000, '대전광역시 서구 둔산동 1413']
];

const statuses = ['SALE', 'SALE', 'SALE', 'RESERVED', 'SOLD'];

function svgForPost(index, area, title, price) {
  const hue = (index * 37) % 360;
  const bg = `hsl(${hue}, 58%, 92%)`;
  const accent = `hsl(${hue}, 62%, 40%)`;
  const priceText = price ? `${Number(price).toLocaleString('ko-KR')}원` : '나눔';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700">
  <rect width="900" height="700" rx="56" fill="${bg}"/>
  <rect x="70" y="70" width="760" height="560" rx="44" fill="#fff" opacity="0.92"/>
  <circle cx="725" cy="165" r="74" fill="${accent}" opacity="0.16"/>
  <rect x="120" y="150" width="240" height="190" rx="28" fill="${accent}" opacity="0.18"/>
  <path d="M165 300h150M185 260h110M205 220h70" stroke="${accent}" stroke-width="28" stroke-linecap="round"/>
  <text x="120" y="425" font-family="Arial, sans-serif" font-size="36" font-weight="800" fill="#1f2d1f">${escapeXml(title)}</text>
  <text x="120" y="482" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#55705a">${escapeXml(area)}</text>
  <text x="120" y="548" font-family="Arial, sans-serif" font-size="42" font-weight="900" fill="${accent}">${escapeXml(priceText)}</text>
  <text x="720" y="590" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="900" fill="#2f8f2f">eats TALK</text>
</svg>`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, char => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[char]));
}

async function main() {
  fs.mkdirSync(uploadDir, { recursive: true });
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM talk_posts');
    await client.query("DELETE FROM users WHERE login_id LIKE 'talkdemo%' OR email LIKE 'talkdemo%@eatspay.local'");

    for (let i = 0; i < posts.length; i += 1) {
      const n = i + 1;
      const [area, title, body, price, address] = posts[i];
      const loginId = `talkdemo${String(n).padStart(2, '0')}`;
      const email = `${loginId}@eatspay.local`;
      const franchiseName = `${area} 이츠상점`;
      let imageName = realImageNames[i % realImageNames.length];
      if (!fs.existsSync(path.join(uploadDir, imageName))) {
        imageName = `talk-demo-${String(n).padStart(2, '0')}.svg`;
        fs.writeFileSync(path.join(uploadDir, imageName), svgForPost(n, area, title, price), 'utf8');
      }

      const userResult = await client.query(
        `INSERT INTO users (
           email, login_id, password_hash, name, franchise_name, role, phone, address, tel, business_number, contact_email
         )
         VALUES ($1, $2, '', $3, $4, 'OWNER', $5, $6, $7, $8, $1)
         RETURNING id, franchise_id`,
        [
          email,
          loginId,
          `${area} 대표`,
          franchiseName,
          `010-${String(2600 + n).padStart(4, '0')}-${String(4300 + n).padStart(4, '0')}`,
          address,
          `032-${String(700 + n)}-${String(1000 + n)}`,
          `TALK${String(2026062100 + n)}`
        ]
      );
      const user = userResult.rows[0];
      await client.query(
        `INSERT INTO talk_posts (
           user_id, franchise_id, franchise_name, title, body, price, image_url, image_urls,
           status, trade_status, view_count, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'ACTIVE', $9, $10,
                 now() - ($11::int * interval '47 minutes'),
                 now() - ($11::int * interval '47 minutes'))`,
        [
          user.id,
          user.franchise_id,
          franchiseName,
          title,
          body,
          price,
          `/uploads/${imageName}`,
          JSON.stringify([`/uploads/${imageName}`]),
          statuses[i % statuses.length],
          8 + (i * 3),
          i
        ]
      );
    }
    await client.query('COMMIT');
    console.log(`Seeded ${posts.length} talk demo posts with address-backed sellers and images.`);
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
