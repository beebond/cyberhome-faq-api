const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// =========================
// 文件路径
// =========================
const KNOWLEDGE_DIR = path.join(__dirname, "knowledge");

const FAQS_PATH = path.join(KNOWLEDGE_DIR, "faqs_database.json");
const PRODUCTS_PATH = path.join(KNOWLEDGE_DIR, "products_master.json");
const PRODUCT_DESCRIPTIONS_PATH = path.join(
  KNOWLEDGE_DIR,
  "product_descriptions.json"
);
const POLICIES_PATH = path.join(KNOWLEDGE_DIR, "policies_database.json");
const BLOGS_PATH = path.join(KNOWLEDGE_DIR, "blog_articles.json");

// =========================
// 全局缓存
// =========================
let FAQS = [];
let PRODUCTS = [];
let PRODUCT_DESCRIPTIONS = [];
let POLICIES = [];
let BLOGS = [];

let PRODUCT_DESC_MAP = new Map();
let LAST_LOADED_AT = null;

// =========================
// 工具函数
// =========================
function safeReadJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[WARN] File not found: ${filePath}`);
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[ERROR] Failed to read JSON: ${filePath}`, error);
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9\u4e00-\u9fff\s\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function includesAny(haystack, words = []) {
  const h = normalizeText(haystack);
  return words.some((w) => w && h.includes(normalizeText(w)));
}

function uniqueBy(array, key) {
  const seen = new Set();
  const result = [];

  for (const item of array) {
    const value = item?.[key];
    if (!seen.has(value)) {
      seen.add(value);
      result.push(item);
    }
  }

  return result;
}

function dedupeProductsByIdentity(products = []) {
  const seen = new Set();
  const result = [];

  for (const p of products) {
    const model = normalizeText(p.model || p.product_id || "");
    const title = normalizeText(p.title || "");
    const handle = normalizeText(p.handle || "");
    const key = model || handle || title;
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }

  return result;
}

function cleanModelToken(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^\w\-]/g, "")
    .trim();
}

function extractModelTokens(query) {
  const raw = String(query || "").toUpperCase();
  const matches = raw.match(/[A-Z]{1,6}-[A-Z0-9]{2,10}|[A-Z]{2,10}[0-9]{2,10}[A-Z0-9]*/g) || [];
  const cleaned = matches
    .map(cleanModelToken)
    .filter((x) => x.length >= 5);

  return [...new Set(cleaned)];
}

function hasPartsIntent(query) {
  const q = normalizeText(query);
  return (
    includesAny(q, [
      "replacement",
      "replacements",
      "part",
      "parts",
      "accessory",
      "accessories",
      "jar",
      "glass jar",
      "lid",
      "seal",
      "gasket",
      "配件",
      "零件",
      "玻璃杯",
      "玻璃罐",
      "盖子",
    ])
  );
}

// =========================
// 数据加载
// =========================
function loadData() {
  FAQS = safeReadJson(FAQS_PATH, []);
  PRODUCTS = safeReadJson(PRODUCTS_PATH, []);
  PRODUCT_DESCRIPTIONS = safeReadJson(PRODUCT_DESCRIPTIONS_PATH, []);
  POLICIES = safeReadJson(POLICIES_PATH, []);
  BLOGS = safeReadJson(BLOGS_PATH, []);

  PRODUCT_DESC_MAP = new Map();

  for (const item of PRODUCT_DESCRIPTIONS) {
    if (item && item.handle) {
      PRODUCT_DESC_MAP.set(item.handle, item);
    }
  }

  LAST_LOADED_AT = new Date().toISOString();

  console.log("[INFO] Data loaded");
  console.log(`[INFO] FAQs: ${FAQS.length}`);
  console.log(`[INFO] Products: ${PRODUCTS.length}`);
  console.log(`[INFO] Product descriptions: ${PRODUCT_DESCRIPTIONS.length}`);
  console.log(`[INFO] Policies: ${POLICIES.length}`);
  console.log(`[INFO] Blogs: ${BLOGS.length}`);
}

loadData();

// =========================
// 查询意图 / 品类识别
// =========================
function detectFamily(query) {
  const q = normalizeText(query);

  if (
    q.includes("bottle washer") ||
    q.includes("bottle sterilizer dryer") ||
    q.includes("baby bottle washer")
  ) {
    return "bottle_washer_sterilizer";
  }

  if (
    q.includes("bottle warmer") ||
    q.includes("milk warmer") ||
    q.includes("breast milk warmer") ||
    q.includes("baby bottle warmer") ||
    q.includes("暖奶")
  ) {
    return "bottle_warmer";
  }

  if (
    q.includes("baby food maker") ||
    q.includes("baby food processor") ||
    q.includes("baby steamer blender") ||
    q.includes("辅食机")
  ) {
    return "baby_food_maker";
  }

  if (
    q.includes("yogurt") ||
    q.includes("greek yogurt") ||
    q.includes("酸奶")
  ) {
    return "yogurt_maker";
  }

  if (
    q.includes("egg cooker") ||
    q.includes("egg boiler") ||
    q.includes("egg steamer") ||
    q.includes("蒸蛋器")
  ) {
    return "egg_cooker";
  }

  if (
    q.includes("glass jar") ||
    q.includes("jar") ||
    q.includes("lid") ||
    q.includes("replacement") ||
    q.includes("part") ||
    q.includes("配件") ||
    q.includes("玻璃杯") ||
    q.includes("盖子")
  ) {
    return "replacement_parts";
  }

  if (
    q.includes("rice cooker") ||
    q.includes("电饭") ||
    q.includes("煮饭")
  ) {
    return "rice_cooker";
  }

  if (
    q.includes("cheong fun") ||
    q.includes("cheung fun") ||
    q.includes("rice roll") ||
    q.includes("rice noodle roll") ||
    q.includes("肠粉")
  ) {
    return "rice_roll_steamer";
  }

  if (q.includes("air fryer")) {
    return "air_fryer";
  }

  if (
    q.includes("nut milk") ||
    q.includes("oat milk maker") ||
    q.includes("soy milk maker") ||
    q.includes("bean milk machine") ||
    q.includes("豆浆")
  ) {
    return "nut_milk_maker";
  }

  if (
    q.includes("juicer") ||
    q.includes("cold press") ||
    q.includes("slow juicer") ||
    q.includes("榨汁机")
  ) {
    return "juicer";
  }

  if (
    q.includes("ice shaver") ||
    q.includes("snow cone") ||
    q.includes("shaved ice")
  ) {
    return "ice_shaver";
  }

  if (
    q.includes("pasta maker") ||
    q.includes("noodle maker") ||
    q.includes("automatic noodles") ||
    q.includes("面条机")
  ) {
    return "pasta_maker";
  }

  if (
    q.includes("dough maker") ||
    q.includes("dough mixer") ||
    q.includes("knead") ||
    q.includes("bread dough") ||
    q.includes("和面")
  ) {
    return "dough_maker";
  }

  if (
    q.includes("kettle") ||
    q.includes("health kettle") ||
    q.includes("tea kettle") ||
    q.includes("water kettle") ||
    q.includes("养生壶")
  ) {
    return "kettle";
  }

  if (q.includes("humidifier") || q.includes("加湿器")) {
    return "humidifier";
  }

  if (q.includes("air purifier") || q.includes("hepa purifier")) {
    return "air_purifier";
  }

  if (
    q.includes("vacuum") ||
    q.includes("mattress vacuum") ||
    q.includes("bed vacuum") ||
    q.includes("除螨")
  ) {
    return "vacuum_cleaner";
  }

  if (q.includes("sterilizer")) {
    return "sterilizer";
  }

  return "";
}

function detectIntent(query) {
  const q = normalizeText(query);

  const policyKeywords = [
    "refund",
    "return",
    "cancel",
    "modify",
    "contact",
    "support",
    "shipping",
    "delivery",
    "track",
    "tracking",
    "warranty",
    "repair",
    "voltage",
    "payment",
    "discount",
    "vip",
    "member",
    "policy",
    "terms",
  ];

  const blogKeywords = [
    "how to",
    "guide",
    "benefit",
    "healthy",
    "wellness",
    "fermentation",
    "yogurt recipe",
    "warm drinks",
    "gentle cooking",
    "lifestyle",
    "nutrition",
    "gut health",
    "probiotic",
  ];

  const productKeywords = [
    "buy",
    "recommend",
    "product",
    "model",
    "which one",
    "do you have",
    "looking for",
    "show me",
    "available",
    "egg cooker",
    "yogurt maker",
    "air fryer",
    "rice cooker",
    "kettle",
    "blender",
    "juicer",
    "humidifier",
    "vacuum",
    "sterilizer",
    "bottle warmer",
    "baby food maker",
    "dough maker",
  ];

  let intent = "general";

  if (policyKeywords.some((k) => q.includes(k))) {
    intent = "policy";
  }

  if (blogKeywords.some((k) => q.includes(k))) {
    intent = intent === "policy" ? "mixed" : "education";
  }

  if (productKeywords.some((k) => q.includes(k))) {
    intent = intent === "general" ? "product" : "mixed";
  }

  return intent;
}

// =========================
// FAQ / Policy / Blog 评分
// =========================
function scoreFaq(faq, query) {
  const q = normalizeText(query);
  const qWords = tokenize(query);

  const title = normalizeText(faq.title || faq.question || "");
  const question = normalizeText(faq.question || "");
  const answer = normalizeText(faq.answer || "");
  const tags = Array.isArray(faq.tags)
    ? faq.tags.join(" ")
    : String(faq.tags || "");

  const variants = Array.isArray(faq.question_variants)
    ? faq.question_variants.map(normalizeText).join(" ")
    : "";

  let score = 0;
  if (!q) return 0;

  if (title.includes(q)) score += 12;
  if (question.includes(q)) score += 12;
  if (variants.includes(q)) score += 14;
  if (answer.includes(q)) score += 5;
  if (normalizeText(tags).includes(q)) score += 6;

  for (const w of qWords) {
    if (title.includes(w)) score += 3;
    if (question.includes(w)) score += 3;
    if (variants.includes(w)) score += 4;
    if (answer.includes(w)) score += 1;
    if (normalizeText(tags).includes(w)) score += 2;
  }

  score += Number(faq.priority || 0) * 0.3;
  return score;
}

function scorePolicy(policy, query) {
  const q = normalizeText(query);
  const qWords = tokenize(query);

  const title = normalizeText(policy.title || "");
  const answer = normalizeText(policy.answer || policy.content || "");
  const tags = Array.isArray(policy.tags)
    ? policy.tags.join(" ")
    : String(policy.tags || "");

  const variants = Array.isArray(policy.question_variants)
    ? policy.question_variants.map(normalizeText).join(" ")
    : "";

  let score = 0;
  if (!q) return 0;

  if (title.includes(q)) score += 12;
  if (variants.includes(q)) score += 14;
  if (answer.includes(q)) score += 6;
  if (normalizeText(tags).includes(q)) score += 5;

  for (const w of qWords) {
    if (title.includes(w)) score += 3;
    if (variants.includes(w)) score += 4;
    if (answer.includes(w)) score += 1;
    if (normalizeText(tags).includes(w)) score += 2;
  }

  score += Number(policy.priority || 0) * 0.3;
  return score;
}

function scoreBlog(blog, query) {
  const q = normalizeText(query);
  const qWords = tokenize(query);

  const title = normalizeText(blog.title || "");
  const summary = normalizeText(blog.summary || "");
  const category = normalizeText(blog.category || "");
  const tags = Array.isArray(blog.tags)
    ? blog.tags.join(" ")
    : String(blog.tags || "");
  const topics = Array.isArray(blog.topics)
    ? blog.topics.join(" ")
    : String(blog.topics || "");

  const variants = Array.isArray(blog.question_variants)
    ? blog.question_variants.map(normalizeText).join(" ")
    : "";

  let score = 0;
  if (!q) return 0;

  if (title.includes(q)) score += 12;
  if (variants.includes(q)) score += 14;
  if (summary.includes(q)) score += 7;
  if (category.includes(q)) score += 6;
  if (normalizeText(tags).includes(q)) score += 5;
  if (normalizeText(topics).includes(q)) score += 5;

  for (const w of qWords) {
    if (title.includes(w)) score += 3;
    if (variants.includes(w)) score += 4;
    if (summary.includes(w)) score += 2;
    if (category.includes(w)) score += 2;
    if (normalizeText(tags).includes(w)) score += 2;
    if (normalizeText(topics).includes(w)) score += 2;
  }

  score += Number(blog.priority || 0) * 0.2;
  return score;
}

// =========================
// 产品过滤 / 合并
// =========================
function isProductActive(product) {
  if (product.active_for_ai === false) return false;

  const stock = normalizeText(product.stock_status);
  if (stock === "inactive" || stock === "archived" || stock === "draft") {
    return false;
  }

  return true;
}

function normalizeAliases(product = {}) {
  const aliases = [];

  if (Array.isArray(product.aliases)) aliases.push(...product.aliases);
  if (Array.isArray(product.alias_models)) aliases.push(...product.alias_models);
  if (Array.isArray(product.compatible_models)) aliases.push(...product.compatible_models);

  return [...new Set(aliases.map(cleanModelToken).filter(Boolean))];
}

function getMergedProduct(product) {
  const desc = PRODUCT_DESC_MAP.get(product.handle) || {};

  return {
    ...product,
    short_description:
      product.short_description ||
      product.description_short ||
      desc.short_description ||
      "",
    body_text: desc.body_text || product.body_text || "",
    use_case: product.use_case || desc.use_case || [],
    ai_tags: product.ai_tags || desc.ai_tags || [],
    category_tree: product.category_tree || desc.category_tree || "",
    aliases: normalizeAliases(product),
  };
}

function familyEquivalentMatch(productFamily, detectedFamily) {
  const pf = normalizeText(productFamily);
  const df = normalizeText(detectedFamily);

  if (!pf || !df) return false;
  if (pf === df) return true;

  const equivalents = {
    pasta_maker: ["dough_maker"],
    dough_maker: ["pasta_maker"],
  };

  return Array.isArray(equivalents[df]) && equivalents[df].includes(pf);
}

function shouldRejectByFamily(product, detectedFamily, partsIntent, modelTokens = []) {
  if (!detectedFamily) return false;

  const pf = normalizeText(product.product_family || "");
  const title = normalizeText(product.title || "");
  const keywords = Array.isArray(product.search_keywords)
    ? product.search_keywords.map(normalizeText).join(" ")
    : "";
  const hay = `${title} ${keywords} ${normalizeText(product.category_tree || "")}`;

  // 型号搜索不做过度拒绝，改为强排序
  if (modelTokens.length > 0 && (cleanModelToken(product.model) || product.aliases?.length)) {
    return false;
  }

  if (detectedFamily === "yogurt_maker") {
    if (pf === "replacement_parts" && !partsIntent) return true;
    if (!familyEquivalentMatch(pf, detectedFamily) && pf !== "yogurt_maker") return true;
    if (!hay.includes("yogurt") && pf !== "yogurt_maker") return true;
  }

  if (detectedFamily === "baby_food_maker") {
    if (pf === "replacement_parts" && !partsIntent) return true;
    if (!familyEquivalentMatch(pf, detectedFamily) && pf !== "baby_food_maker") return true;
    if (!includesAny(hay, ["baby food", "baby steamer blender", "baby food maker", "baby food processor"])) {
      return true;
    }
  }

  if (detectedFamily === "dough_maker") {
    if (pf === "replacement_parts" && !partsIntent) return true;
    if (!["dough_maker", "pasta_maker"].includes(pf)) return true;
  }

  if (detectedFamily === "juicer") {
    if (pf !== "juicer") return true;
  }

  if (detectedFamily === "air_purifier") {
    if (pf !== "air_purifier") return true;
  }

  if (detectedFamily === "bottle_warmer") {
    if (pf === "replacement_parts" && !partsIntent) return true;
    if (!["bottle_warmer", "baby_food_maker"].includes(pf)) return true;
  }

  if (detectedFamily === "replacement_parts" && !partsIntent && pf === "replacement_parts") {
    return true;
  }

  return false;
}

// =========================
// 产品评分（V7 precision）
/* 设计思路：
 * 1. 型号精确命中 > 家族命中 > 关键词命中
 * 2. 整机优先，配件默认降权
 * 3. 明确 family 时尽量只在该 family 内排序
 */
function scoreProduct(product, query, detectedFamily = "") {
  const q = normalizeText(query);
  const qWords = tokenize(query);
  const modelTokens = extractModelTokens(query);
  const partsIntent = hasPartsIntent(query);

  const title = normalizeText(product.title);
  const handle = normalizeText(product.handle);
  const model = cleanModelToken(product.model || product.product_id || "");
  const family = normalizeText(product.product_family || "");
  const categoryTree = normalizeText(product.category_tree || "");
  const productType = normalizeText(product.product_type || "");
  const shortDesc = normalizeText(
    product.description_short || product.short_description || ""
  );
  const bodyText = normalizeText(product.body_text || "");

  const aliases = Array.isArray(product.aliases) ? product.aliases : [];
  const tags = Array.isArray(product.tags) ? product.tags.map(normalizeText) : [];
  const aiTags = Array.isArray(product.ai_tags)
    ? product.ai_tags.map(normalizeText)
    : [];
  const searchKeywords = Array.isArray(product.search_keywords)
    ? product.search_keywords.map(normalizeText)
    : [];
  const negativeKeywords = Array.isArray(product.negative_keywords)
    ? product.negative_keywords.map(normalizeText)
    : [];
  const useCase = Array.isArray(product.use_case)
    ? product.use_case.map(normalizeText)
    : [];
  const compatibleModels = Array.isArray(product.compatible_models)
    ? product.compatible_models.map(cleanModelToken)
    : [];

  let score = 0;

  if (!q) return 0;
  if (!isProductActive(product)) return -999;
  if (shouldRejectByFamily(product, detectedFamily, partsIntent, modelTokens)) return -999;

  // 1) 型号命中：最强
  if (modelTokens.length > 0) {
    for (const token of modelTokens) {
      if (model && token === model) score += 180;
      if (aliases.includes(token)) score += 150;
      if (compatibleModels.includes(token)) score += family === "replacement_parts" ? 40 : 70;
      if (title.toUpperCase().includes(token)) score += 80;
      if (handle.toUpperCase().includes(token)) score += 60;
    }
  }

  // 2) 原 query 精确词组命中
  if (title.includes(q)) score += 30;
  if (model && q.includes(model.toLowerCase())) score += 25;
  if (handle.includes(q)) score += 12;
  if (categoryTree.includes(q)) score += 10;
  if (productType.includes(q)) score += 8;
  if (searchKeywords.some((kw) => kw.includes(q) || q.includes(kw))) score += 20;
  if (aiTags.some((kw) => kw.includes(q) || q.includes(kw))) score += 12;
  if (useCase.some((kw) => kw.includes(q) || q.includes(kw))) score += 10;

  // 3) family 强加权
  if (detectedFamily) {
    if (familyEquivalentMatch(family, detectedFamily) || family === detectedFamily) {
      score += 50;
    } else {
      score -= 25;
    }
  }

  // 4) 关键词逐词命中
  for (const w of qWords) {
    if (title.includes(w)) score += 6;
    if (model.toLowerCase().includes(w)) score += 5;
    if (handle.includes(w)) score += 3;
    if (categoryTree.includes(w)) score += 3;
    if (productType.includes(w)) score += 3;
    if (shortDesc.includes(w)) score += 2;
    if (bodyText.includes(w)) score += 1;
    if (tags.some((t) => t.includes(w))) score += 2;
    if (aiTags.some((t) => t.includes(w))) score += 2;
    if (useCase.some((u) => u.includes(w))) score += 2;
    if (searchKeywords.some((kw) => kw.includes(w))) score += 4;
  }

  // 5) 整机 / 配件排序逻辑
  if (family === "replacement_parts") {
    if (partsIntent) {
      score += 25;
    } else {
      score -= 120;
    }
  } else {
    score += 15;
  }

  // 6) 某些多功能产品：在 bottle_warmer 查询时 baby_food_maker 可作为次级结果
  if (detectedFamily === "bottle_warmer" && family === "baby_food_maker") {
    score += 10;
  }

  // 7) 明显跨类惩罚
  if (detectedFamily === "yogurt_maker" && !includesAny(title, ["yogurt"])) {
    score -= 60;
  }
  if (detectedFamily === "baby_food_maker" && !includesAny(title, ["baby food"])) {
    score -= 50;
  }
  if (detectedFamily === "juicer" && !includesAny(title, ["juicer", "cold press"])) {
    score -= 70;
  }
  if (detectedFamily === "air_purifier" && !includesAny(title, ["air purifier"])) {
    score -= 70;
  }
  if (detectedFamily === "dough_maker" && !includesAny(title, ["dough", "pasta", "noodle"])) {
    score -= 50;
  }

  for (const bad of negativeKeywords) {
    if (bad && q.includes(bad)) {
      score -= 10;
    }
  }

  if (!product.image_url) score -= 2;
  score += Number(product.display_priority || 0) * 0.2;

  return score;
}

// =========================
// 格式化输出
// =========================
function formatFaqResult(faq) {
  return {
    id: faq.id || "",
    type: faq.type || "faq",
    title: faq.title || faq.question || "",
    question: faq.question || faq.title || "",
    answer: faq.answer || "",
    url: faq.url || "",
    tags: faq.tags || [],
    priority: faq.priority || 0,
    score: faq.score || 0,
  };
}

function formatPolicyResult(policy) {
  return {
    id: policy.id || "",
    type: policy.type || "policy",
    title: policy.title || "",
    answer: policy.answer || policy.content || "",
    url: policy.url || "",
    tags: policy.tags || [],
    priority: policy.priority || 0,
    score: policy.score || 0,
  };
}

function formatBlogResult(blog) {
  return {
    id: blog.id || "",
    type: blog.type || "blog",
    title: blog.title || "",
    summary: blog.summary || "",
    category: blog.category || "",
    url: blog.url || "",
    tags: blog.tags || [],
    topics: blog.topics || [],
    related_products: blog.related_products || [],
    priority: blog.priority || 0,
    score: blog.score || 0,
  };
}

function formatProductResult(p) {
  return {
    title: p.title,
    handle: p.handle,
    product_id: p.product_id || p.model || "",
    model: p.model || p.product_id || "",
    product_type: p.product_type || "",
    product_family: p.product_family || "",
    category_tree: p.category_tree || "",
    price: p.price,
    image_url: p.image_url || "",
    url: p.url || "",
    short_description: p.description_short || p.short_description || "",
    stock_status: p.stock_status || "",
    tags: p.tags || [],
    ai_tags: p.ai_tags || [],
    use_case: p.use_case || [],
    aliases: p.aliases || [],
    compatible_models: p.compatible_models || [],
    active_for_ai: p.active_for_ai !== false,
    display_priority: p.display_priority || 0,
    score: p.score,
  };
}

// =========================
// 路由
// =========================
app.get("/", (req, res) => {
  res.json({
    service: "CyberHome Knowledge API",
    status: "ok",
    version: "V7",
    loaded_at: LAST_LOADED_AT,
    counts: {
      faqs: FAQS.length,
      products: PRODUCTS.length,
      descriptions: PRODUCT_DESCRIPTIONS.length,
      policies: POLICIES.length,
      blogs: BLOGS.length,
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "V7",
    loaded_at: LAST_LOADED_AT,
    counts: {
      faqs: FAQS.length,
      products: PRODUCTS.length,
      descriptions: PRODUCT_DESCRIPTIONS.length,
      policies: POLICIES.length,
      blogs: BLOGS.length,
    },
  });
});

app.post("/reload", (req, res) => {
  try {
    loadData();
    return res.json({
      ok: true,
      message: "Data reloaded successfully",
      loaded_at: LAST_LOADED_AT,
      counts: {
        faqs: FAQS.length,
        products: PRODUCTS.length,
        descriptions: PRODUCT_DESCRIPTIONS.length,
        policies: POLICIES.length,
        blogs: BLOGS.length,
      },
    });
  } catch (error) {
    console.error("[ERROR] Reload failed:", error);
    return res.status(500).json({
      ok: false,
      error: "reload_failed",
      details: error.message,
    });
  }
});

app.get("/api/search", (req, res) => {
  try {
    const query = String(req.query.q || "").trim();

    const limitFaqs = clamp(Number(req.query.limit_faqs || 8), 1, 20);
    const limitProducts = clamp(Number(req.query.limit_products || 12), 1, 20);
    const limitPolicies = clamp(Number(req.query.limit_policies || 5), 1, 20);
    const limitBlogs = clamp(Number(req.query.limit_blogs || 5), 1, 20);

    if (!query) {
      return res.json({
        query,
        faqMatches: [],
        productMatches: [],
        policyMatches: [],
        blogMatches: [],
        meta: {
          faqCount: 0,
          productsCount: 0,
          policiesCount: 0,
          blogsCount: 0,
          detectedFamily: "",
          detectedIntent: "general",
          modelTokens: [],
          loadedAt: LAST_LOADED_AT,
        },
      });
    }

    const detectedFamily = detectFamily(query);
    const detectedIntent = detectIntent(query);
    const modelTokens = extractModelTokens(query);
    const partsIntent = hasPartsIntent(query);

    // FAQ
    const faqMatches = FAQS
      .map((faq) => ({
        ...faq,
        score: scoreFaq(faq, query),
      }))
      .filter((faq) => faq.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limitFaqs)
      .map(formatFaqResult);

    // Products
    const productMatches = dedupeProductsByIdentity(
      PRODUCTS
        .map((p) => getMergedProduct(p))
        .filter((p) => isProductActive(p))
        .map((p) => ({
          ...p,
          score: scoreProduct(p, query, detectedFamily),
        }))
        .filter((p) => p.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return Number(b.display_priority || 0) - Number(a.display_priority || 0);
        })
    )
      .slice(0, limitProducts)
      .map(formatProductResult);

    // Policies
    const policyMatches = POLICIES
      .map((policy) => ({
        ...policy,
        score: scorePolicy(policy, query),
      }))
      .filter((policy) => policy.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limitPolicies)
      .map(formatPolicyResult);

    // Blogs
    const blogMatches = BLOGS
      .map((blog) => ({
        ...blog,
        score: scoreBlog(blog, query),
      }))
      .filter((blog) => blog.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limitBlogs)
      .map(formatBlogResult);

    return res.json({
      query,
      faqMatches,
      productMatches,
      policyMatches,
      blogMatches,
      meta: {
        faqCount: faqMatches.length,
        productsCount: productMatches.length,
        policiesCount: policyMatches.length,
        blogsCount: blogMatches.length,
        detectedFamily,
        detectedIntent,
        modelTokens,
        partsIntent,
        loadedAt: LAST_LOADED_AT,
      },
    });
  } catch (error) {
    console.error("[ERROR] /api/search failed:", error);
    return res.status(500).json({
      error: "search_failed",
      details: error.message,
    });
  }
});

// =========================
// 启动
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[INFO] CyberHome Knowledge API V7 is running on port ${PORT}`);
});
