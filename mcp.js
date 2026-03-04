const express = require('express');
const router = express.Router();
const manifest = require('./mcp-manifest.json');
const { searchFAQ, searchProducts } = require('./api.js');

// MCP 协议发现端点
router.get('/.well-known/mcp/manifest.json', (req, res) => {
  res.json(manifest);
});

// MCP 工具调用端点 - 统一搜索
router.post('/mcp/v1/tools/search', (req, res) => {
  try {
    const { query, type = 'all' } = req.body.parameters || {};
    
    if (!query) {
      return res.status(400).json({
        error: { message: 'Missing query parameter' }
      });
    }

    const faqResults = type === 'all' || type === 'faq' ? searchFAQ(query, { maxResults: 3 }) : [];
    const productResults = type === 'all' || type === 'product' ? searchProducts(query, { maxResults: 3 }) : [];
    
    // 构建回复
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
      });
    }
    
    if (!reply) {
      reply = '抱歉，我没有找到相关信息。您可以尝试换个问法，或联系在线客服。';
    }
    
    res.json({
      content: [{
        type: "text",
        text: reply.trim()
      }],
      metadata: {
        faqCount: faqResults.length,
        productCount: productResults.length,
        source: "FAQ + Product Knowledge Base"
      }
    });
    
  } catch (error) {
    res.status(500).json({
      error: { message: error.message }
    });
  }
});

// 兼容旧的FAQ搜索
router.post('/mcp/v1/tools/search_faq', (req, res) => {
  try {
    const { query } = req.body.parameters || {};
    
    if (!query) {
      return res.status(400).json({
        error: { message: 'Missing query parameter' }
      });
    }

    const results = searchFAQ(query, { maxResults: 1 });
    
    if (results.length > 0) {
      res.json({
        content: [{
          type: "text",
          text: results[0].answer
        }],
        metadata: {
          confidence: results[0].score,
          source: "FAQ Knowledge Base"
        }
      });
    } else {
      res.json({
        content: [{
          type: "text",
          text: "抱歉，我没有在FAQ中找到这个问题的答案。"
        }]
      });
    }
  } catch (error) {
    res.status(500).json({
      error: { message: error.message }
    });
  }
});

module.exports = router;