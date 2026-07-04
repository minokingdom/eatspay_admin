const CARDGORILLA_CDN_BASE = 'https://d1c5n4ri2guedi.cloudfront.net';
const CARDGORILLA_DETAIL_BASE = 'https://www.card-gorilla.com/card/detail';

function parseJsonField(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
}

function normalizeImageUrl(value) {
  const image = String(value || '').trim();
  if (!image) return '';
  if (/^https?:\/\//i.test(image)) return image;
  if (image.startsWith('//')) return `https:${image}`;
  if (image.startsWith('/')) return `${CARDGORILLA_CDN_BASE}${image}`;
  return `${CARDGORILLA_CDN_BASE}/${image}`;
}

function buildBenefitPhrase(benefit) {
  const tags = Array.isArray(benefit?.tags) ? benefit.tags.map(normalizeText).filter(Boolean) : [];
  const phrase = normalizeText(tags.join(' '));
  if (phrase) return phrase;
  return normalizeText(benefit?.title);
}

function buildSummary(item, benefits) {
  const summary = benefits
    .map(buildBenefitPhrase)
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
  if (summary) return summary;
  return normalizeText(item.no_cmt || item.event_title || '카드 혜택을 확인해보세요.');
}

function extractDiscountRate(text) {
  const matches = String(text || '').matchAll(/(\d+(?:\.\d+)?)\s*%/g);
  const values = Array.from(matches, match => Number(match[1])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function uniqueStrings(values) {
  const seen = new Set();
  return values
    .map(normalizeText)
    .filter(Boolean)
    .filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseCardGorillaRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

function mapCardGorillaCard(item) {
  const corp = parseJsonField(item.corp, {});
  const benefits = parseJsonField(item.top_benefit, []);
  const cardIdx = String(item.card_idx || item.idx || '').trim();
  const cardCompany = normalizeText(corp.name || item.card_company || item.company || '');
  const cardName = normalizeText(item.name || item.no_cmt || '');
  const summary = buildSummary(item, Array.isArray(benefits) ? benefits : []);
  const benefitTags = Array.isArray(benefits)
    ? benefits.flatMap(benefit => [benefit?.title, ...(Array.isArray(benefit?.tags) ? benefit.tags : [])])
    : [];

  if (!cardCompany || !cardName) return null;

  return {
    source: 'cardgorilla',
    sourceUrl: cardIdx ? `${CARDGORILLA_DETAIL_BASE}/${cardIdx}` : 'https://www.card-gorilla.com/chart/top100',
    rankNo: Number.isFinite(Number(item.ranking)) ? Number(item.ranking) : null,
    cardCompany,
    cardName,
    summary,
    discountRate: extractDiscountRate(summary),
    annualFee: normalizeText(item.annual_fee_basic),
    tags: uniqueStrings([...benefitTags, item.event_title]),
    sourceCardIdx: cardIdx,
    imageUrl: normalizeImageUrl(item.card_img),
    eventTitle: normalizeText(item.event_title),
    active: item.is_visible === undefined ? true : Number(item.is_visible) !== 0
  };
}

function parseCardGorillaRanking(payload) {
  return parseCardGorillaRows(payload)
    .map(mapCardGorillaCard)
    .filter(Boolean)
    .sort((a, b) => {
      const rankA = Number.isFinite(Number(a.rankNo)) ? Number(a.rankNo) : Number.MAX_SAFE_INTEGER;
      const rankB = Number.isFinite(Number(b.rankNo)) ? Number(b.rankNo) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB || a.cardCompany.localeCompare(b.cardCompany, 'ko') || a.cardName.localeCompare(b.cardName, 'ko');
    });
}

module.exports = {
  parseCardGorillaRanking
};
