const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

// ============ FAQ 数据库加载 ============
let faqs = [];
try {
  faqs = require('./faqs_database.json');
  console.log(`✅ 加载了 ${faqs.length} 条FAQ`);
} catch (error) {
  console.log('⚠️ FAQ数据库未找到，请先运行: npm run sync');
  console.log('使用空数据库继续运行...');
  faqs = [];
}

// ============ 搜索算法（必须导出供 mcp.js 使用） ============
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
    
    // 1. 完全匹配问题（最高权重）
    if (question.includes(query.toLowerCase())) {
      score += 20;
    }
    
    // 2. 关键词匹配
    keywords.forEach(keyword => {
      const qMatches = (question.match(new RegExp(keyword, 'g')) || []).length;
      score += qMatches * 3;
      
      const aMatches = (answer.match(new RegExp(keyword, 'g')) || []).length;
      score += aMatches * 2;
      
      if (faq.tags.some(tag => tag.toLowerCase() === keyword)) {
        score += 10;
      }
    });
    
    // 3. 优先级加成
    score += (6 - (faq.priority || 5));
    
    // 4. 答案长度权重
    const answerLength = faq.answer.length;
    if (answerLength > 20 && answerLength < 500) {
      score += 2;
    }
    
    return {
      ...faq,
      score,
      matchedKeywords: keywords.filter(kw => 
        question.includes(kw) || answer.includes(kw) || faq.tags.some(tag => tag.toLowerCase().includes(kw))
      )
    };
  });
  
  return scoredFAQs
    .filter(item => item.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.priority || 5) - (b.priority || 5);
    })
    .slice(0, maxResults);
}

// ============ MCP 插件支持（LobeChat官方集成） ============
// 加载 MCP 插件路由
const mcpRouter = require('./mcp');
app.use('/', mcpRouter);

// ============ 原有 API 端点 ============
// GET 搜索
app.get('/api/faq/search', (req, res) => {
  const { q, limit = 5, minScore = 1 } = req.query;
  
  if (!q) {
    return res.status(400).json({ 
      error: '缺少查询参数 q',
      example: '/api/faq/search?q=香薰机怎么用'
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
    results: results.map(item => ({
      id: item.id,
      question: item.question,
      answer: item.answer,
      tags: item.tags,
      product: item.product,
      score: item.score,
      matchedKeywords: item.matchedKeywords
    }))
  });
});

// POST 搜索
app.post('/api/faq/search', (req, res) => {
  const { message, sessionId } = req.body;
  
  if (!message) {
    return res.status(400).json({ 
      success: false,
      error: '消息内容不能为空'
    });
  }
  
  const results = searchFAQ(message, { maxResults: 3 });
  
  const response = {
    success: true,
    query: message,
    hasExactMatch: results.length > 0 && results[0].score > 15,
    suggestedAnswer: results.length > 0 ? results[0].answer : null,
    allMatches: results.map(item => ({
      question: item.question,
      answer: item.answer.substring(0, 150) + (item.answer.length > 150 ? '...' : ''),
      confidence: Math.min(100, Math.round(item.score * 5))
    })),
    metadata: {
      faqCount: faqs.length,
      searchTime: new Date().toISOString(),
      sessionId: sessionId || 'anonymous'
    }
  };
  
  res.json(response);
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'CyberHome FAQ API',
    version: '1.0.0',
    faqCount: faqs.length,
    uptime: process.uptime(),
    endpoints: [
      'GET  /api/faq/search?q=问题',
      'POST /api/faq/search {message: "问题"}',
      'GET  /health',
      'GET  /sync-now',
      'GET  /.well-known/mcp/manifest.json',
      'POST /mcp/v1/tools/search_faq'
    ]
  });
});

// 手动触发同步
app.get('/sync-now', async (req, res) => {
  try {
    const { syncFAQs } = require('./sync.js');
    const count = await syncFAQs();
    // 重新加载最新的 FAQ 数据
    delete require.cache[require.resolve('./faqs_database.json')];
    faqs = require('./faqs_database.json');
    res.json({ 
      success: true, 
      message: `同步成功，更新了 ${count} 条FAQ`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 获取所有FAQ（调试用）
app.get('/api/faq/all', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const result = faqs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  
  res.json({
    total: faqs.length,
    limit: parseInt(limit),
    offset: parseInt(offset),
    faqs: result
  });
});

// ============ 导出供 mcp.js 使用 ============
module.exports = { searchFAQ, app };

// ============ 启动服务器 ============
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
🚀 CyberHome FAQ API 已启动!
📍 地址: http://localhost:${PORT}
📚 FAQ数量: ${faqs.length}
🔍 测试搜索: curl "http://localhost:${PORT}/api/faq/search?q=return"
📊 健康检查: curl "http://localhost:${PORT}/health"
🔄 手动同步: curl "http://localhost:${PORT}/sync-now"
🤖 MCP 清单: curl "http://localhost:${PORT}/.well-known/mcp/manifest.json"
🧩 MCP 调用: curl -X POST http://localhost:${PORT}/mcp/v1/tools/search_faq \\
    -H "Content-Type: application/json" \\
    -d '{"parameters":{"query":"return policy"}}'
    `);
  });
}