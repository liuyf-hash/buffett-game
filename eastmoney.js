/**
 * 东方财富免费 API 封装
 * 所有接口无需 API Key，HTTP GET 返回 JSON
 */
const fs = require('fs');
const path = require('path');

const STOCKS_FILE = path.join(__dirname, 'data', 'stocks.json');

// A股列表API - 获取全量股票代码和名称
async function fetchStockList() {
  const allStocks = [];
  const baseUrl = 'https://push2.eastmoney.com/api/qt/clist/get';
  const pageSize = 100;

  // 先获取第一页，知道总数
  let url = `${baseUrl}?pn=1&pz=${pageSize}&po=1&np=1&fields=f12,f14&fst=1&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23`;
  let res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  let data = await res.json();
  if (!data?.data?.diff) throw new Error('获取股票列表失败');

  const total = data.data.total;
  allStocks.push(...data.data.diff.map(d => ({ code: d.f12, name: d.f14 })).filter(s => s.code && s.name));

  // 分页获取剩余
  const totalPages = Math.ceil(total / pageSize);
  for (let pn = 2; pn <= totalPages; pn++) {
    url = `${baseUrl}?pn=${pn}&pz=${pageSize}&po=1&np=1&fields=f12,f14&fst=1&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23`;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      data = await res.json();
      if (data?.data?.diff) {
        allStocks.push(...data.data.diff.map(d => ({ code: d.f12, name: d.f14 })).filter(s => s.code && s.name));
      }
    } catch (e) {
      console.error(`获取第${pn}页失败:`, e.message);
    }
  }

  return allStocks;
}

// 加载股票列表（优先从缓存，否则抓取）
async function loadStocks() {
  if (fs.existsSync(STOCKS_FILE)) {
    return JSON.parse(fs.readFileSync(STOCKS_FILE, 'utf-8'));
  }
  console.log('正在从东方财富获取A股列表...');
  const stocks = await fetchStockList();
  fs.writeFileSync(STOCKS_FILE, JSON.stringify(stocks, null, 2));
  console.log(`已缓存 ${stocks.length} 只A股`);
  return stocks;
}

// 随机选一只A股，排除已选过的
function pickRandomStock(stocks, excludeCodes = []) {
  const available = stocks.filter(s => !excludeCodes.includes(s.code));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * 获取年报财务数据
 * 返回: { revenue, netProfit, totalAssets, totalLiabilities, operatingCashFlow,
 *         totalShares, reportDate, noticeDate, debtRatio }
 * 所有金额单位为元
 */
async function fetchAnnualFinancialData(code, year) {
  const baseUrl = 'https://datacenter.eastmoney.com/api/data/v1/get';
  const url = `${baseUrl}?reportName=RPT_F10_FINANCE_MAINFINADATA` +
    `&columns=SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,REPORT_TYPE,` +
    `TOTALOPERATEREVE,TOTALOPERATEREVETZ,YYZSRGDHBZC,MLR,PARENTNETPROFIT,PARENTNETPROFITTZ,NETPROFITRPHBZC,` +
    `KCFJCXSYJLR,KCFJCXSYJLRTZ,TOTAL_ASSETS_PK,TOTAL_EQUITY_PK,NETCASH_OPERATE_PK,NOTICE_DATE,ZCFZL,TOTAL_SHARE,` +
    `EPSJB,EPSKCJB,EPSXS,BPS,MGZBGJ,MGWFPLR,MGJYXJJE,` +
    `ROEJQ,ROEKCJQ,XSJLL,XSMLL,XSJXLYYSR,JYXJLYYSR,TAXRATE,LD,SD,XJLLB,CQBL,ROIC,` +
    `TOAZZL,CHZZL,YSZKZZL,ZZCZZTS,CHZZTS,YSZKZZTS,ZZCJLL` +
    `&filter=(SECURITY_CODE=%22${code}%22)&pageNumber=1&pageSize=15&sortTypes=-1&sortColumns=REPORT_DATE`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    if (!data?.result?.data) return null;

    // 过滤年报 (12-31)
    const annualReports = data.result.data.filter(r =>
      r.REPORT_DATE && r.REPORT_DATE.includes('12-31') && r.REPORT_TYPE === '年报'
    );
    if (annualReports.length === 0) return null;

    // 找对应年份
    const report = annualReports.find(r => r.REPORT_DATE.startsWith(String(year)));
    if (!report) return null;

    const totalAssets = report.TOTAL_ASSETS_PK;
    const totalEquity = report.TOTAL_EQUITY_PK;

    return {
      // ===== 利润表 =====
      revenue: report.TOTALOPERATEREVE,
      grossProfit: report.MLR,
      grossMargin: report.XSMLL,
      netProfit: report.PARENTNETPROFIT,
      deductedNetProfit: report.KCFJCXSYJLR,
      netMargin: report.XSJLL,
      revenueYoy: report.TOTALOPERATEREVETZ,
      revenueQoq: report.YYZSRGDHBZC,
      netProfitYoy: report.PARENTNETPROFITTZ,
      netProfitQoq: report.NETPROFITRPHBZC,
      deductedNetProfitYoy: report.KCFJCXSYJLRTZ,
      eps: report.EPSJB,
      epsDeducted: report.EPSKCJB,
      epsDiluted: report.EPSXS,
      // ===== 资产负债表 =====
      totalAssets,
      totalEquity,
      totalLiabilities: totalAssets - totalEquity,
      debtRatio: report.ZCFZL,
      equityRatio: report.CQBL,
      bps: report.BPS,
      capReservePerShare: report.MGZBGJ,
      retainedEarningsPerShare: report.MGWFPLR,
      currentRatio: report.LD,
      quickRatio: report.SD,
      assetTurnover: report.TOAZZL,
      inventoryTurnover: report.CHZZL,
      receivablesTurnover: report.YSZKZZL,
      assetTurnoverDays: report.ZZCZZTS,
      inventoryTurnoverDays: report.CHZZTS,
      receivablesTurnoverDays: report.YSZKZZTS,
      // ===== 现金流量表 =====
      operatingCashFlow: report.NETCASH_OPERATE_PK,
      cfPerShare: report.MGJYXJJE,
      cfRatio: report.XJLLB,
      cashToRevenue: report.XSJXLYYSR,
      ocfToRevenue: report.JYXJLYYSR,
      // ===== 盈利能力 =====
      roe: report.ROEJQ,
      roeDeducted: report.ROEKCJQ,
      roic: report.ROIC,
      roa: report.ZZCJLL,
      taxRate: report.TAXRATE,
      // ===== 其他 =====
      totalShares: report.TOTAL_SHARE,
      companyName: report.SECURITY_NAME_ABBR,
      reportDate: report.REPORT_DATE.slice(0, 10),
      noticeDate: report.NOTICE_DATE ? report.NOTICE_DATE.slice(0, 10) : null,
    };
  } catch (e) {
    console.error(`获取财务数据失败 ${code}:`, e.message);
    return null;
  }
}

/**
 * 获取指定日期附近的股价（K线）
 * 返回: { date, open, close, high, low, volume, amount }
 * 会前后尝试最多 10 个交易日找数据
 */
async function fetchStockPriceNear(code, targetDate, maxAttempts = 10) {
  const secId = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const target = new Date(targetDate);

  for (let offset = 0; offset < maxAttempts; offset++) {
    const d = new Date(target);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
    const endStr = dateStr;

    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
        `?secid=${secId}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
        `&klt=101&fqt=1&beg=${dateStr}&end=${endStr}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();

      if (data?.data?.klines?.length > 0) {
        const kline = data.data.klines[0];
        const parts = kline.split(',');
        return {
          date: parts[0],
          open: parseFloat(parts[1]),
          close: parseFloat(parts[2]),
          high: parseFloat(parts[3]),
          low: parseFloat(parts[4]),
          volume: parseFloat(parts[5]),    // 手
          amount: parseFloat(parts[6]),     // 元
        };
      }
    } catch {
      // try next day
    }
  }
  return null;
}

/**
 * 获取公司简介信息（主营业务、公司简介等）
 * 返回: { mainBusiness, orgProfile, mainProducts, incomeStru, csrcIndustry, concepts, orgForm, listingDate, foundDate, controller, realController }
 */
async function fetchCompanyProfile(code) {
  const url = `https://datacenter.eastmoney.com/api/data/v1/get?reportName=RPT_F10_ORG_BASICINFO` +
    `&columns=SECURITY_CODE,SECURITY_NAME_ABBR,ORG_NAME,MAIN_BUSINESS,ORG_PROFILE,ORG_PROFIE,` +
    `BLGAINIAN,CSRC_INDUSTRY_NAME,INCOME_STRU_NAMENEW,INCOME_STRU_RATIONEW,` +
    `ORG_FORM,LISTING_DATE,FOUND_DATE,CONTROL_HOLDER,REAL_CONTROLER,PRODUCT_NAME` +
    `&filter=(SECURITY_CODE=%22${code}%22)&pageNumber=1&pageSize=1`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    if (!data?.result?.data?.[0]) return null;
    const r = data.result.data[0];
    return {
      companyName: r.SECURITY_NAME_ABBR,
      orgName: r.ORG_NAME,
      mainBusiness: r.MAIN_BUSINESS || '',
      orgProfile: r.ORG_PROFILE || r.ORG_PROFIE || '',
      concepts: r.BLGAINIAN || '',
      csrcIndustry: r.CSRC_INDUSTRY_NAME || '',
      incomeStru: r.INCOME_STRU_NAMENEW || '',
      incomeRatio: r.INCOME_STRU_RATIONEW || '',
      orgForm: r.ORG_FORM || '',
      listingDate: r.LISTING_DATE ? r.LISTING_DATE.slice(0, 10) : '',
      foundDate: r.FOUND_DATE ? r.FOUND_DATE.slice(0, 10) : '',
      controller: r.CONTROL_HOLDER || '',
      realController: r.REAL_CONTROLER || '',
      products: r.PRODUCT_NAME || '',
    };
  } catch (e) {
    console.error(`获取公司简介失败 ${code}:`, e.message);
    return null;
  }
}

/**
 * 将文本中的公司名替换为 ***（匿名化处理）
 */
function anonymize(text, companyName) {
  if (!text || !companyName) return text || '';
  let result = text;
  // 替换公司全称简称
  result = result.split(companyName).join('***');
  // 尝试去掉地名后的简称，如 "贵州茅台" → "***"
  if (companyName.length > 2) {
    const shortName = companyName.slice(2); // "茅台"
    result = result.split(shortName).join('***');
  }
  return result;
}

/**
 * 获取行业描述（f127 = 行业名称）
 */
async function fetchIndustryDescription(code) {
  const secId = code.startsWith('6') || code.startsWith('9') ? `1.${code}` : `0.${code}`;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secId}&fields=f57,f127`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    if (data?.data?.f127) {
      return data.data.f127;
    }
  } catch {}
  return '';
}

// 市值区间定义
const MARKET_CAP_RANGES = [
  { id: 0, label: '小于 30亿', min: 0, max: 30 },
  { id: 1, label: '30亿 ~ 80亿', min: 30, max: 80 },
  { id: 2, label: '80亿 ~ 200亿', min: 80, max: 200 },
  { id: 3, label: '200亿 ~ 500亿', min: 200, max: 500 },
  { id: 4, label: '500亿 ~ 1200亿', min: 500, max: 1200 },
  { id: 5, label: '1200亿 ~ 3000亿', min: 1200, max: 3000 },
  { id: 6, label: '3000亿 ~ 8000亿', min: 3000, max: 8000 },
  { id: 7, label: '大于 8000亿', min: 8000, max: Infinity },
];

function getMarketCapRangeIndex(marketCapYi) {
  for (let i = 0; i < MARKET_CAP_RANGES.length; i++) {
    const r = MARKET_CAP_RANGES[i];
    if (marketCapYi >= r.min && marketCapYi < r.max) return i;
  }
  return 0;
}

// 元 转 亿
function yuanToYi(yuan) {
  return yuan / 1e8;
}

module.exports = {
  loadStocks, fetchStockList, pickRandomStock,
  fetchAnnualFinancialData, fetchStockPriceNear, fetchIndustryDescription,
  fetchCompanyProfile, anonymize,
  getMarketCapRangeIndex, MARKET_CAP_RANGES, yuanToYi,
};
