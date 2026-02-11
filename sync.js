const fetch = require('node-fetch');
const { parse } = require('csv-parse/sync');
const fs = require('fs');

async function syncFAQs() {
  try {
    // 你的公开CSV链接
    const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFF0Iw-1rXohO6pmc8gp8tSQX0PEoUZApSFUj7RtcaiE2xodvg_oC-BZdfzE1JrCUDL6oK4FempPlY/pub?output=csv';
    
    console.log('🔄 正在同步Google Sheet...');
    console.log('链接:', csvUrl);
    
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP错误 ${response.status}: ${response.statusText}`);
    }
    
    const csvText = await response.text();
    
    if (!csvText || csvText.trim().length === 0) {
      throw new Error('CSV内容为空，请检查Sheet是否有内容');
    }
    
    console.log('📊 CSV文件大小:', csvText.length, '字符');
    
    // 解析CSV
    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    console.log(`✅ 解析到 ${rows.length} 行数据`);
    
    if (rows.length > 0) {
      console.log('📋 列名:', Object.keys(rows[0]));
    }
    
    // 智能列名映射（适配你的Sheet结构）
    const faqs = rows.map((row, index) => {
      // 自动检测列名 - 根据你的实际列名调整
      const question = row['问题'] || row['question'] || row['Q'] || row['Question'] || row['问题（中文）'] || '';
      const answer = row['答案'] || row['answer'] || row['A'] || row['Answer'] || row['回答'] || '';
      const tags = (row['标签'] || row['tags'] || row['Tag'] || row['分类'] || '').split(',').map(t => t.trim()).filter(t => t);
      const product = row['产品线'] || row['product'] || row['Product'] || '';
      const priority = parseInt(row['优先级'] || row['priority'] || '5');
      
      return {
        id: `faq_${index + 1}`,
        question: question.trim(),
        answer: answer.trim(),
        tags,
        product,
        priority: isNaN(priority) ? 5 : priority,
        createdAt: new Date().toISOString()
      };
    }).filter(faq => faq.question && faq.answer && faq.question.length > 3); // 过滤有效数据
    
    console.log(`✅ 有效FAQ: ${faqs.length} 条`);
    
    // 保存为JSON文件
    fs.writeFileSync('faqs_database.json', JSON.stringify(faqs, null, 2));
    console.log('💾 FAQ数据库已保存到 faqs_database.json');
    
    // 打印统计信息
    if (faqs.length > 0) {
      const tagCount = {};
      faqs.forEach(faq => {
        faq.tags.forEach(tag => {
          tagCount[tag] = (tagCount[tag] || 0) + 1;
        });
      });
      
      console.log('\n📈 统计信息:');
      console.log(`   总FAQ数: ${faqs.length}`);
      console.log(`   总标签数: ${Object.keys(tagCount).length}`);
      console.log(`   热门标签:`, Object.entries(tagCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => `${tag}(${count})`)
        .join(', '));
      
      console.log('\n🔍 前3条FAQ示例:');
      faqs.slice(0, 3).forEach((faq, i) => {
        console.log(`   ${i + 1}. Q: ${faq.question.substring(0, 50)}${faq.question.length > 50 ? '...' : ''}`);
        console.log(`      A: ${faq.answer.substring(0, 50)}${faq.answer.length > 50 ? '...' : ''}`);
        console.log(`      标签: ${faq.tags.join(', ') || '无'}`);
      });
    }
    
    return faqs.length;
    
  } catch (error) {
    console.error('❌ 同步失败:', error.message);
    console.error('堆栈:', error.stack);
    throw error;
  }
}

// 如果直接运行此文件，则执行同步
if (require.main === module) {
  syncFAQs().then(count => {
    console.log(`\n🎉 同步完成！共处理 ${count} 条FAQ`);
    process.exit(0);
  }).catch(error => {
    console.error('同步过程出错');
    process.exit(1);
  });
}

module.exports = { syncFAQs };