const express = require('express');
const router = express.Router();
const manifest = require('./mcp-manifest.json');
const { searchFAQ } = require('./api.js'); // 复用你的搜索函数

// MCP 协议发现端点
router.get('/.well-known/mcp/manifest.json', (req, res) => {
  res.json(manifest);
});

// MCP 工具调用端点
router.post('/mcp/v1/tools/search_faq', (req, res) => {
  try {
    const { query } = req.body.parameters || {};
    
    if (!query) {
      return res.status(400).json({
        error: { message: 'Missing query parameter' }
      });
    }

    // 调用你已有的搜索函数
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
          text: "抱歉，我没有在知识库中找到这个问题的答案。您可以尝试换个问法，或联系在线客服。"
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