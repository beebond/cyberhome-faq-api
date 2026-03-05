const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ============ 数据库加载 ============
let faqs = [];
let products = [];
let productDescs = [];

try {
  faqs = require('./faqs_database.json');
  console.log(`✅ Loaded FAQs: ${faqs.length}`);
} catch (e) {
  console.warn('⚠️ faqs_database.json not found or failed to load');
  faqs = [];
}

try {
  products = require('./products.json');
  console.log(`✅ Loaded products: ${products.length}`);
} catch (e) {
  console.warn('⚠️ products.json not found or failed to load');
  products = [];
}

try {
  productDescs = require('./product_descriptions.json');
  console.log(`✅ Loaded product_descriptions: ${productDescs.length}`);
} catch (e) {
  console.warn('⚠️ product_descriptions.json not found or failed to load');
  productDescs = [];
}

// index product descriptions by handle (preferred) or product_id
const productDescByHandle = new Map();
for (const d of productDescs || []) {
  if (d && d.handle) productDescByHandle.set(String(d.handle).toLowerCase(), d);
  if (d && d.product_id) productDescByHandle.set(String(d.product_id).toLowerCase(), d);
}

// ============ Utils ============
function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(s) {
  const t = norm(s)
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return [];
  return t.split(' ').filter(Boolean);
}

function scoreByTokens(haystack, tokens) {
  if (!haystack || !tokens || tokens.length === 0) return 0;
  const h = norm(haystack);
  let score = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    if (h.includes(tok)) score += 1;
  }
  return score;
}

// ============ FAQ Search ============
function searchFaqs(query, limit = 6) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results = [];
  for (const f of faqs) {
    const q = f.question || '';
    const a = f.answer || '';
    const tags = Array.isArray(f.tags) ? f.tags.join(' ') : (f.tags || '');
    const combined = `${q} ${a} ${tags}`;
    let score = 0;

    // weights
    score += scoreByTokens(q, tokens) * 3;
    score += scoreByTokens(tags, tokens) * 2;
    score += scoreByTokens(a, tokens) * 1;

    if (score > 0) {
      results.push({
        question: q,
        answer: a,
        tags: Array.isArray(f.tags) ? f.tags : (f.tags ? String(f.tags).split(',').map(s => s.trim()).filter(Boolean) : []),
        priority: f.priority || '',
        score
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ============ Product Search ============
function searchProducts(query, limit = 6) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results = [];
  for (const p of products) {
    const title = p.title || p.name || '';
    const handle = p.handle || '';
    const model = p.product_id || p.model || '';
    const type = p.product_type || p.type || '';
    const tags = Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags || '');

    const descObj = productDescByHandle.get(String(handle).toLowerCase()) || productDescByHandle.get(String(model).toLowerCase());
    const desc = (descObj && (descObj.description || descObj.body_html || descObj.body || descObj.text)) || p.description || '';

    const combined = `${title} ${handle} ${model} ${type} ${tags} ${desc}`;

    let score = 0;
    score += scoreByTokens(title, tokens) * 4;
    score += scoreByTokens(type, tokens) * 2;
    score += scoreByTokens(tags, tokens) * 2;
    score += scoreByTokens(desc, tokens) * 1;
    score += scoreByTokens(handle.replace(/-/g, ' '), tokens) * 1;

    // avoid returning everything on generic words
    if (score >= 2) {
      results.push({
        title,
        handle,
        product_id: model,
        product_type: type,
        price: p.price || p.price_usd || '',
        image_url: p.image_url || (p.images && p.images[0]) || '',
        short_description: (desc || '').toString().replace(/\s+/g, ' ').trim().slice(0, 180),
        score
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ============ API ============
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'cyberhome-faq-api', faqs: faqs.length, products: products.length });
});

//兼容两种参数：?q=xxx 或 ?query=xxx
app.get('/api/search', (req, res) => {
  const q = req.query.q || req.query.query || '';
  const query = String(q || '').trim();
  const faqMatches = searchFaqs(query, 6);
  const productMatches = searchProducts(query, 8);
  res.json({ query, faqMatches, productMatches });
});

// 支持 POST: { message: "...", q: "...", query: "...", limitFaq, limitProducts }
app.post('/api/search', (req, res) => {
  const q = req.body?.message || req.body?.q || req.body?.query || '';
  const query = String(q || '').trim();
  const limitFaq = Number(req.body?.limitFaq || 6);
  const limitProducts = Number(req.body?.limitProducts || 8);
  const faqMatches = searchFaqs(query, limitFaq);
  const productMatches = searchProducts(query, limitProducts);
  res.json({ query, faqMatches, productMatches });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 cyberhome-faq-api running on port ${PORT}`));
