const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

// ============ 数据库加载 ============
let faqs = [];
let products = [];
let productDescs = [];

try {
  faqs = require('./faqs_database.json');
  console.log(`✅ 加载了 ${faqs.length} 条FAQ`);
} catch (error) {
  console.log('⚠️ FAQ数据库未找到');
  faqs = [];
}

try {
  products = require('./products.json');
  console.log(`✅ 加载了 ${products.length} 个产品`);
} catch (error) {
  console.log('⚠️ 产品主表未找到');
  products = [];
}

try {
  productDescs = require('./product_descriptions.json');
  console.log(`✅ 加载了 ${productDescs.length} 条产品描述`);
} catch (error) {
  console.log('⚠️ 产品描述库未找到');
  productDescs = [];
}

// ============ FAQ搜索算法 ============
function searchFAQ(query, options = {}) {
  if (!query || query.trim() === '') return [];
  
  const keywords = query.toLowerCase()
    .split(' ')
    .filter(k => k.length > 1)
    .map(k => k.replace(/[^\w\u4e00-\u9fff]/g, ''));
  
  if (keywords.length === 0) return [];
  
  const maxResults = options.maxResults || 5;
  const minScore = options.minScore || 1;
  
  const scoredFAQs = faqs.map(faq => {
    let score = 0;
    const question = faq.question.toLowerCase();
    const answer = faq.answer.toLowerCase();
    const allText = question + ' ' + answer + ' ' + faq.tags.join(' ').toLowerCase();
    
    // 完全匹配问题（最高权重）
    if (question.includes(query.toLowerCase())) {
      score += 20;
    }
    
    // 关键词匹配
    keywords.forEach(keyword => {
      const qMatches = (question.match(new RegExp(keyword, 'g')) || []).length;
      score += qMatches * 3;
      
      const aMatches = (answer.match(new RegExp(keyword, 'g')) || []).length;
      score += aMatches * 2;
      
      if (faq.tags.some(tag => tag.toLowerCase().includes(keyword))) {
        score += 10;
      }
    });
    
    // 优先级加成
    score += (6 - (faq.priority || 5));
    
    return {
      type: 'faq',
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      tags: faq.tags,
      product: faq.product,
      score,
      matchedKeywords: keywords.filter(kw => 
        question.includes(kw) || answer.includes(kw) || faq.tags.some(tag => tag.toLowerCase().includes(kw))
      )
    };
  });
  
  return scoredFAQs
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ============ 产品搜索算法（增强版） ============
function searchProducts(query, options = {}) {
  if (!query || query.trim() === '') return [];
  
  const maxResults = options.maxResults || 5;
  
  // 消毒产品白名单
  const sterilizerProducts = [
    { id: 'QXJ-C05F3', name: 'Bear婴儿奶瓶清洗消毒机', boost: 10000 },
    { id: 'XDG-B05V', name: '婴儿奶瓶消毒烘干机', boost: 10000 },
    { id: 'SJJ-M03P1', name: '婴儿辅食机（带消毒）', boost: 8000 },
    { id: 'NNQ-E03P8', name: '婴儿温奶器（带消毒）', boost: 5000 },
    { id: 'NNQ-A03F1', name: '婴儿温奶消毒器', boost: 5000 },
    { id: 'CMY-H03G5', name: '紫外线除螨仪（带UV杀菌）', boost: 3000 },
    { id: 'TNQ-E05P8', name: '便携式温奶器', boost: 2000 },
    { id: 'TNQ-C03R6', name: '便携式温奶器', boost: 2000 }
  ];
  
  // 空气炸锅产品白名单
  const airFryerProducts = [
    { id: 'QZG-T17U7', name: 'Bear 6.3QT智能空气炸锅', boost: 10000 },
    { id: 'QZG-S08C3', name: 'Bear 2.1QT迷你空气炸锅', boost: 10000 },
    { id: 'QZG-P15J5', name: 'Bear 6.4QT空气炸锅', boost: 10000 },
    { id: 'QZG-F15E3', name: 'Bear 5.3QT空气炸锅', boost: 8000 },
    { id: 'QZG-B14C1', name: 'Bear 6.5L空气炸锅', boost: 8000 }
  ];
  
  // 婴儿产品白名单
  const babyProducts = [
    { id: 'QXJ-C05F3', boost: 5000 },
    { id: 'SJJ-M03P1', boost: 5000 },
    { id: 'B0FL7K9WMX', boost: 5000 },
    { id: 'NNQ-E03P8', boost: 5000 },
    { id: 'NNQ-H05M1', boost: 5000 },
    { id: 'TNQ-E05P8', boost: 5000 },
    { id: 'TNQ-C03R6', boost: 5000 },
    { id: 'XDG-B05V', boost: 5000 },
    { id: 'P21', boost: 4000 },
    { id: 'YD0301', boost: 4000 },
    { id: 'MQ-JS001', boost: 4000 },
    { id: 'MW-CC012', boost: 3000 }
  ];
  
  console.log('🔍 搜索查询:', query);
  
  // 1. 判断查询类型
  const queryLower = query.toLowerCase();
  const isSterilizeQuery = queryLower.includes('消毒') || 
                           queryLower.includes('杀菌') || 
                           queryLower.includes('sterilize') || 
                           queryLower.includes('sterilization') ||
                           queryLower.includes('sanitize') ||
                           queryLower.includes('uv-c') ||
                           queryLower.includes('uvc');
  
  const isAirFryerQuery = queryLower.includes('空气炸锅') || 
                          queryLower.includes('air fryer') || 
                          queryLower.includes('fryer') ||
                          queryLower.includes('炸锅');
  
  const isBabyQuery = queryLower.includes('婴儿') || 
                     queryLower.includes('宝宝') || 
                     queryLower.includes('baby') ||
                     queryLower.includes('newborn') ||
                     queryLower.includes('infant') ||
                     queryLower.includes('奶瓶') ||
                     queryLower.includes('bottle') ||
                     queryLower.includes('辅食') ||
                     queryLower.includes('food');
  
  // 2. 关键词提取
  const keywords = queryLower
    .split(' ')
    .filter(k => k.length > 1)
    .map(k => k.replace(/[^\w\u4e00-\u9fff]/g, ''));
  
  // 3. 搜索产品描述库
  const descResults = productDescs.map(desc => {
    let score = 0;
    const text = desc.chunk_text.toLowerCase();
    const productId = desc.product_id;
    
    // 基础关键词匹配
    keywords.forEach(keyword => {
      const matches = (text.match(new RegExp(keyword, 'g')) || []).length;
      score += matches * 10;
    });
    
    // 消毒相关词匹配
    if (isSterilizeQuery) {
      if (text.includes('消毒')) score += 100;
      if (text.includes('杀菌')) score += 100;
      if (text.includes('sterilize')) score += 100;
      if (text.includes('sterilization')) score += 100;
      if (text.includes('sanitize')) score += 80;
      if (text.includes('uv-c')) score += 80;
      if (text.includes('uvc')) score += 80;
      if (text.includes('紫外线')) score += 80;
    }
    
    // 空气炸锅相关词匹配
    if (isAirFryerQuery) {
      if (text.includes('空气炸锅')) score += 200;
      if (text.includes('air fryer')) score += 200;
      if (text.includes('fryer')) score += 150;
      if (text.includes('炸锅')) score += 150;
      if (text.includes('crisp')) score += 100;
    }
    
    // 婴儿产品相关词匹配
    if (isBabyQuery) {
      if (text.includes('婴儿')) score += 100;
      if (text.includes('宝宝')) score += 100;
      if (text.includes('baby')) score += 100;
      if (text.includes('奶瓶')) score += 100;
      if (text.includes('bottle')) score += 100;
      if (text.includes('辅食')) score += 100;
      if (text.includes('food')) score += 50;
    }
    
    // 检查白名单
    if (isSterilizeQuery) {
      const whiteProduct = sterilizerProducts.find(p => p.id === productId);
      if (whiteProduct) {
        score += whiteProduct.boost;
      }
    }
    
    if (isAirFryerQuery) {
      const whiteProduct = airFryerProducts.find(p => p.id === productId);
      if (whiteProduct) {
        score += whiteProduct.boost;
      }
    }
    
    if (isBabyQuery) {
      const whiteProduct = babyProducts.find(p => p.id === productId);
      if (whiteProduct) {
        score += whiteProduct.boost;
      }
    }
    
    // 检查产品ID特征
    if (productId.includes('QXJ') || productId.includes('XDG')) {
      if (isSterilizeQuery) score += 500;
    }
    if (productId.includes('QZG')) {
      if (isAirFryerQuery) score += 500;
    }
    
    return {
      type: 'product_desc',
      product_id: productId,
      info: desc.chunk_text.substring(0, 100),
      score
    };
  }).filter(r => r.score > 0);
  
  // 4. 按产品ID合并分数
  const productScores = {};
  descResults.forEach(r => {
    if (!productScores[r.product_id]) {
      productScores[r.product_id] = {
        product_id: r.product_id,
        score: 0,
        matches: []
      };
    }
    productScores[r.product_id].score += r.score;
    productScores[r.product_id].matches.push(r.info);
  });
  
  // 5. 获取产品详细信息
  const results = Object.values(productScores).map(ps => {
    const product = products.find(p => p.product_id === ps.product_id);
    return {
      type: 'product',
      product_id: ps.product_id,
      title: product?.title || 'Unknown Product',
      price: product?.price,
      vendor: product?.vendor,
      tags: product?.tags || [],
      description_short: product?.description_short,
      matches: ps.matches.slice(0, 2),
      score: ps.score
    };
  });
  
  // 按分数排序
  const sorted = results.sort((a, b) => b.score - a.score);
  
  console.log('📊 搜索结果:', sorted.map(p => ({ 
    id: p.product_id, 
    score: p.score, 
    title: p.title?.substring(0, 30) + '...' 
  })));
  
  return sorted.slice(0, maxResults);
}

// ============ 统一搜索API ============
app.get('/api/search', (req, res) => {
  const { q, type = 'all', limit = 5 } = req.query;
  
  if (!q) {
    return res.status(400).json({ 
      error: '缺少查询参数 q',
      example: '/api/search?q=空气炸锅'
    });
  }
  
  const results = {
    query: q,
    faq: type === 'all' || type === 'faq' ? searchFAQ(q, { maxResults: parseInt(limit) }) : [],
    products: type === 'all' || type === 'product' ? searchProducts(q, { maxResults: parseInt(limit) }) : []
  };
  
  res.json({
    success: true,
    query: q,
    type,
    totalResults: results.faq.length + results.products.length,
    faqCount: results.faq.length,
    productCount: results.products.length,
    results
  });
});

// ============ 原有FAQ搜索API（保持兼容）============
app.get('/api/faq/search', (req, res) => {
  const { q, limit = 5, minScore = 1 } = req.query;
  
  if (!q) {
    return res.status(400).json({ 
      error: '缺少查询参数 q',
      example: '/api/faq/search?q=退货政策'
    });
  }
  
  const results = searchFAQ(q, { 
    maxResults: parseInt(limit),
    minScore: parseInt(minScore)
  });
  
  res.json({
    success: true,
    query: q,
    totalResults: results.length,
    faqCount: faqs.length,
    results
  });
});

// ============ 产品搜索API ============
app.get('/api/product/search', (req, res) => {
  const { q, limit = 5 } = req.query;
  
  if (!q) {
    return res.status(400).json({ 
      error: '缺少查询参数 q',
      example: '/api/product/search?q=消毒'
    });
  }
  
  const results = searchProducts(q, { maxResults: parseInt(limit) });
  
  res.json({
    success: true,
    query: q,
    totalResults: results.length,
    productCount: products.length,
    results
  });
});

// ============ 产品详情API ============
app.get('/api/product/:id', (req, res) => {
  const product = products.find(p => p.product_id === req.params.id);
  
  if (!product) {
    return res.status(404).json({ error: '产品未找到' });
  }
  
  // 获取该产品的所有描述片段
  const descriptions = productDescs.filter(d => d.product_id === product.product_id);
  
  res.json({
    success: true,
    product,
    descriptions: descriptions.slice(0, 10)
  });
});

// ============ POST统一搜索（供MCP调用）============
app.post('/api/search', (req, res) => {
  const { message, type = 'all' } = req.body;
  
  if (!message) {
    return res.status(400).json({ 
      success: false,
      error: '消息内容不能为空'
    });
  }
  
  const faqResults = type === 'all' || type === 'faq' ? searchFAQ(message, { maxResults: 3 }) : [];
  const productResults = type === 'all' || type === 'product' ? searchProducts(message, { maxResults: 3 }) : [];
  
  // 构建友好回复
  let reply = '';
  
  if (faqResults.length > 0) {
    reply += `📚 常见问题：\n`;
    faqResults.slice(0, 1).forEach(faq => {
      reply += `Q: ${faq.question}\nA: ${faq.answer}\n\n`;
    });
  }
  
  if (productResults.length > 0) {
    if (faqResults.length > 0) reply += '---\n\n';
    reply += `🛒 相关产品：\n`;
    productResults.slice(0, 2).forEach(p => {
      reply += `• ${p.title}${p.price ? ` - $${p.price}` : ''}\n`;
      if (p.matches && p.matches.length > 0) {
        const matchText = p.matches[0].replace(/<[^>]*>/g, '').substring(0, 100);
        reply += `  ${matchText}...\n`;
      }
    });
  }
  
  if (!reply) {
    reply = '抱歉，我没有找到相关信息。您可以尝试换个问法，或联系在线客服。';
  }
  
  res.json({
    success: true,
    query: message,
    hasResults: faqResults.length > 0 || productResults.length > 0,
    reply: reply.trim(),
    faqMatches: faqResults,
    productMatches: productResults,
    metadata: {
      faqCount: faqs.length,
      productCount: products.length,
      searchTime: new Date().toISOString()
    }
  });
});

// ============ MCP 插件路由 ============
let mcpRouter;
try {
  mcpRouter = require('./mcp');
  app.use('/', mcpRouter);
  console.log('✅ MCP 插件已加载');
} catch (error) {
  console.log('⚠️ MCP 插件未找到，仅提供API服务');
}

// ============ 健康检查 ============
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'CyberHome 知识库 API',
    version: '2.0.0',
    stats: {
      faqCount: faqs.length,
      productCount: products.length,
      productDescCount: productDescs.length
    },
    uptime: process.uptime(),
    endpoints: [
      'GET  /api/search?q=问题&type=all',
      'GET  /api/faq/search?q=问题',
      'GET  /api/product/search?q=产品',
      'GET  /api/product/:id',
      'POST /api/search {message: "问题"}',
      'GET  /health'
    ]
  });
});

// ============ 产品详情API（支持型号查询） ============
app.get('/api/product/model/:model', (req, res) => {
  const model = req.params.model.toUpperCase();
  
  // 在产品主表中查找
  const product = products.find(p => p.product_id.toUpperCase() === model);
  
  if (!product) {
    return res.status(404).json({ 
      success: false, 
      error: '产品型号未找到' 
    });
  }
  
  // 获取该产品的所有描述片段
  const descriptions = productDescs.filter(d => d.product_id.toUpperCase() === model);
  
  res.json({
    success: true,
    product,
    descriptions: descriptions.slice(0, 10),
    fullDescription: descriptions.map(d => d.chunk_text).join('\n\n')
  });
});

// 添加一个更友好的搜索接口
app.get('/api/product/search-by-model', (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: '请提供查询参数 q' });
  }
  
  const query = q.toUpperCase();
  
  // 模糊匹配产品ID
  const matches = products.filter(p => 
    p.product_id.toUpperCase().includes(query) ||
    p.title.toUpperCase().includes(query)
  );
  
  res.json({
    success: true,
    query: q,
    totalResults: matches.length,
    results: matches.slice(0, 5)
  });
});

// ============ 导出供 mcp.js 使用 ============
module.exports = { searchFAQ, searchProducts, app };

// ============ 启动服务器 ============
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
🚀 CyberHome 知识库 API v2.0 已启动!
📍 地址: http://localhost:${PORT}
📊 数据统计:
   - FAQ: ${faqs.length} 条
   - 产品: ${products.length} 个
   - 产品描述: ${productDescs.length} 条
🔍 测试统一搜索: curl "http://localhost:${PORT}/api/search?q=空气炸锅"
📚 测试FAQ搜索: curl "http://localhost:${PORT}/api/faq/search?q=退货"
🛒 测试产品搜索: curl "http://localhost:${PORT}/api/product/search?q=消毒"
    `);
  });
}