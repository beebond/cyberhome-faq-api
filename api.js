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
const FAQS_PATH = path.join(__dirname, "faqs_database.json");
const PRODUCTS_PATH = path.join(__dirname, "products_master.json");
const PRODUCT_DESCRIPTIONS_PATH = path.join(__dirname, "product_descriptions.json");

// =========================
// 全局缓存
// =========================
let FAQS = [];
let PRODUCTS = [];
let PRODUCT_DESCRIPTIONS = [];
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

function includesAny(haystack, words = []) {
  const h = normalizeText(haystack);
  return words.some((w) => w && h.includes(normalizeText(w)));
}

function uniqueBy(array, key) {
  const seen = new Set();
  const result = [];
  for (const item of array) {
    const value = item[key];
    if (!seen.has(value)) {
      seen.add(value);
      result.push(item);
    }
  }
  return result;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  const v = normalizeText(value);
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
  return null;
}

// =========================
// 数据加载
// =========================
function loadData() {
  FAQS = safeReadJson(FAQS_PATH, []);
  PRODUCTS = safeReadJson(PRODUCTS_PATH, []);
  PRODUCT_DESCRIPTIONS = safeReadJson(PRODUCT_DESCRIPTIONS_PATH, []);

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
}

loadData();

// =========================
// FAQ 评分
// =========================
function scoreFaq(faq, query) {
  const q = normalizeText(query);
  const qWords = tokenize(query);

  const question = normalizeText(faq.question);
  const answer = normalizeText(faq.answer);
  const tags = Array.isArray(faq.tags)
    ? faq.tags.join(" ")
    : String(faq.tags || "");

  let score = 0;

  if (!q) return 0;

  if (question.includes(q)) score += 12;
  if (answer.includes(q)) score += 6;
  if (normalizeText(tags).includes(q)) score += 6;

  for (const w of qWords) {
    if (question.includes(w)) score += 3;
    if (answer.includes(w)) score += 1;
    if (normalizeText(tags).includes(w)) score += 2;
  }

  const priority = Number(faq.priority || 0);
  score += priority * 0.2;

  return score;
}

// =========================
// 识别查询意图 / 品类
// =========================
function detectFamily(query) {
  const q = normalizeText(query);

  if (
    q.includes("yogurt") ||
    q.includes("greek yogurt") ||
    q.includes("酸奶")
  ) {
    return "yogurt_maker";
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
    q.includes("rice roll") ||
    q.includes("rice noodle roll") ||
    q.includes("肠粉")
  ) {
    return "rice_roll_steamer";
  }

  if (q.includes("blender") || q.includes("smoothie")) {
    return "blender";
  }

  if (q.includes("humidifier")) {
    return "humidifier";
  }

  if (q.includes("sterilizer")) {
    return "sterilizer";
  }

  if (q.includes("soymilk") || q.includes("soy milk") || q.includes("豆浆")) {
    return "soymilk_maker";
  }

  if (
    q.includes("bean sprouts") ||
    q.includes("sprouts machine") ||
    q.includes("豆芽")
  ) {
    return "bean_sprouts_machine";
  }

  if (q.includes("dough") || q.includes("pasta maker") || q.includes("和面")) {
    return "dough_maker";
  }

  return "";
}

// =========================
// 产品过滤
// =========================
function isProductActive(product) {
  if (product.active_for_ai === false) return false;

  const stock = normalizeText(product.stock_status);
  if (stock === "inactive" || stock === "archived" || stock === "draft") {
    return false;
  }

  return true;
}

function getMergedProduct(product) {
  const desc = PRODUCT_DESC_MAP.get(product.handle) || {};

  return {
    ...product,
    short_description:
      product.description_short ||
      desc.short_description ||
      "",
    body_text:
      desc.body_text ||
      "",
    key_features: desc.key_features || [],
    use_cases: desc.use_cases || [],
    care_notes: desc.care_notes || [],
    bullets: desc.bullets || [],
  };
}

// =========================
// 产品评分
// =========================
function scoreProduct(product, query, detectedFamily = "") {
  const q = normalizeText(query);
  const qWords = tokenize(query);

  const title = normalizeText(product.title);
  const handle = normalizeText(product.handle);
  const model = normalizeText(product.model || product.product_id || "");
  const family = normalizeText(product.product_family || "");
  const category = normalizeText(product.category || "");
  const primaryCategory = normalizeText(product.primary_category || "");
  const shortDesc = normalizeText(product.description_short || product.short_description || "");
  const bodyText = normalizeText(product.body_text || "");

  const tags = Array.isArray(product.tags) ? product.tags.map(normalizeText) : [];
  const searchKeywords = Array.isArray(product.search_keywords)
    ? product.search_keywords.map(normalizeText)
    : [];
  const negativeKeywords = Array.isArray(product.negative_keywords)
    ? product.negative_keywords.map(normalizeText)
    : [];

  const haystack = [
    title,
    handle,
    model,
    family,
    category,
    primaryCategory,
    shortDesc,
    bodyText,
    tags.join(" "),
    searchKeywords.join(" "),
  ].join(" ");

  let score = 0;

  if (!q) return 0;
  if (!isProductActive(product)) return -999;

  // 完整短语命中
  if (title.includes(q)) score += 30;
  if (model && q.includes(model)) score += 25;
  if (handle.includes(q)) score += 12;
  if (searchKeywords.some((kw) => kw.includes(q) || q.includes(kw))) score += 20;
  if (family && detectedFamily && family === detectedFamily) score += 18;

  // 分词命中
  for (const w of qWords) {
    if (title.includes(w)) score += 6;
    if (model.includes(w)) score += 5;
    if (handle.includes(w)) score += 3;
    if (shortDesc.includes(w)) score += 2;
    if (bodyText.includes(w)) score += 1;
    if (tags.some((t) => t.includes(w))) score += 2;
    if (searchKeywords.some((kw) => kw.includes(w))) score += 4;
  }

  // 品类强化
  if (detectedFamily) {
    if (family === detectedFamily) {
      score += 15;
    } else if (
      detectedFamily === "replacement_parts" &&
      (family === "yogurt_accessory" || family === "replacement_parts")
    ) {
      score += 10;
    } else {
      score -= 8;
    }
  }

  // 负面词压制
  for (const bad of negativeKeywords) {
    if (bad && q.includes(bad)) {
      score -= 10;
    }
  }

  // 低质量/无图压制
  if (!product.image_url) score -= 2;

  // 配件与主机的轻微区分
  if (
    detectedFamily === "yogurt_maker" &&
    (family === "replacement_parts" || family === "yogurt_accessory")
  ) {
    score -= 8;
  }

  if (
    detectedFamily === "replacement_parts" &&
    family === "yogurt_maker"
  ) {
    score -= 6;
  }

  // 人工排序
  score += Number(product.display_priority || 0) * 0.2;

  return score;
}

// =========================
// 路由
// =========================
app.get("/", (req, res) => {
  res.json({
    service: "CyberHome FAQ API",
    status: "ok",
    loaded_at: LAST_LOADED_AT,
    faqs_count: FAQS.length,
    products_count: PRODUCTS.length,
    descriptions_count: PRODUCT_DESCRIPTIONS.length,
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    loaded_at: LAST_LOADED_AT,
    counts: {
      faqs: FAQS.length,
      products: PRODUCTS.length,
      descriptions: PRODUCT_DESCRIPTIONS.length,
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
    const limitFaqs = Math.min(Number(req.query.limit_faqs || 8), 20);
    const limitProducts = Math.min(Number(req.query.limit_products || 12), 20);

    if (!query) {
      return res.json({
        query,
        faqMatches: [],
        productMatches: [],
        meta: {
          faqCount: 0,
          productsCount: 0,
          detectedFamily: "",
        },
      });
    }

    const detectedFamily = detectFamily(query);

    // FAQ
    const faqMatches = FAQS
      .map((faq) => ({
        ...faq,
        score: scoreFaq(faq, query),
      }))
      .filter((faq) => faq.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limitFaqs)
      .map((faq) => ({
        question: faq.question,
        answer: faq.answer,
        tags: faq.tags || [],
        priority: faq.priority || 0,
        score: faq.score,
      }));

    // Products
    const productMatches = PRODUCTS
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
      .slice(0, limitProducts)
      .map((p) => ({
        title: p.title,
        handle: p.handle,
        product_id: p.product_id || p.model || "",
        model: p.model || p.product_id || "",
        product_type: p.product_family || p.primary_category || "",
        product_family: p.product_family || "",
        category: p.category || "",
        price: p.price,
        image_url: p.image_url || "",
        short_description: p.description_short || p.short_description || "",
        stock_status: p.stock_status || "",
        tags: p.tags || [],
        active_for_ai: p.active_for_ai !== false,
        display_priority: p.display_priority || 0,
        score: p.score,
      }));

    return res.json({
      query,
      faqMatches,
      productMatches,
      meta: {
        faqCount: faqMatches.length,
        productsCount: productMatches.length,
        detectedFamily,
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
  console.log(`[INFO] CyberHome FAQ API is running on port ${PORT}`);
});