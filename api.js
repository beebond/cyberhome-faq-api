const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

const faqsPath = path.join(__dirname, "faqs_database.json");
const productsPath = path.join(__dirname, "products.json");

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read JSON:", filePath, err);
    return [];
  }
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function tokenize(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreFAQ(faq, query) {
  const qWords = tokenize(query);
  const haystack = normalizeText([
    faq.question,
    faq.answer,
    Array.isArray(faq.tags) ? faq.tags.join(" ") : faq.tags || ""
  ].join(" "));

  let score = 0;
  for (const w of qWords) {
    if (haystack.includes(w)) score += 1;
  }
  return score;
}

function scoreProduct(product, query) {
  const qWords = tokenize(query);
  const haystack = normalizeText([
    product.title,
    product.handle,
    product.product_id,
    product.type,
    product.category,
    product.description_short,
    Array.isArray(product.tags) ? product.tags.join(" ") : ""
  ].join(" "));

  let score = 0;
  for (const w of qWords) {
    if (haystack.includes(w)) score += 1;
  }

  const q = normalizeText(query);

  if (q.includes("yogurt") && haystack.includes("yogurt")) score += 5;
  if (q.includes("rice cooker") && haystack.includes("rice cooker")) score += 5;
  if (
    (q.includes("rice roll") || q.includes("cheong fun") || q.includes("rice noodle roll")) &&
    (haystack.includes("rice roll") || haystack.includes("cheong fun") || haystack.includes("rice noodle roll"))
  ) score += 6;
  if (q.includes("steamer") && haystack.includes("steamer")) score += 3;
  if (q.includes("blender") && haystack.includes("blender")) score += 5;
  if (q.includes("jar") && haystack.includes("jar")) score += 4;
  if (q.includes("parts") && haystack.includes("parts")) score += 4;

  return score;
}

app.get("/", (req, res) => {
  res.send("CyberHome FAQ API is running.");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/search", (req, res) => {
  const query = req.query.q || "";
  const faqs = readJSON(faqsPath);
  const products = readJSON(productsPath);

  const faqMatches = faqs
    .map((f) => ({
      ...f,
      score: scoreFAQ(f, query),
    }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((f) => ({
      question: f.question,
      answer: f.answer,
      tags: f.tags || [],
      priority: f.priority || 0,
      score: f.score,
    }));

  const productMatches = products
    .map((p) => ({
      ...p,
      score: scoreProduct(p, query),
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((p) => ({
      title: p.title,
      handle: p.handle,
      product_id: p.product_id,
      product_type: p.type || p.product_type || "",
      price: p.price,
      image_url: p.image_url || "",
      short_description: p.description_short || "",
      stock_status: p.stock_status || "",
      tags: p.tags || [],
      category: p.category || "",
      score: p.score,
    }));

  res.json({
    query,
    faqMatches,
    productMatches,
  });
});

app.listen(PORT, () => {
  console.log(`CyberHome FAQ API running on port ${PORT}`);
});