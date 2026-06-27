/**
 * 从东方财富获取 A 股全量股票列表并缓存到 data/stocks.json
 * 运行: node fetch-stocks.js
 */
const em = require('./eastmoney');
(async () => {
  try {
    const stocks = await em.fetchStockList();
    const fs = require('fs');
    fs.writeFileSync('./data/stocks.json', JSON.stringify(stocks, null, 2));
    console.log(`✅ 已缓存 ${stocks.length} 只 A 股到 data/stocks.json`);
  } catch (e) {
    console.error('❌ 失败:', e.message);
  }
})();
