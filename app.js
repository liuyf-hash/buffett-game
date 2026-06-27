const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');
const em = require('./eastmoney');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- 中间件 ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session（使用内存存储，重启后登录会丢失）
app.use(session({
  secret: 'buffett-game-secret-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));

// 设置 EJS 模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 初始化数据库
db.initDB();

// 异步初始化股票列表
let stocksCache = [];
(async () => {
  try {
    stocksCache = await em.loadStocks();
    console.log(`已加载 ${stocksCache.length} 只A股`);
  } catch (e) {
    console.error('加载股票列表失败:', e.message);
  }
})();

// ---------- 辅助函数 ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  next();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.scryptSync(password, salt, 64).toString('hex') === hash;
}

function pickRange(marketCapYi) {
  const ranges = em.MARKET_CAP_RANGES;
  for (let i = 0; i < ranges.length; i++) {
    if (marketCapYi >= ranges[i].min && marketCapYi < ranges[i].max) return i;
  }
  return ranges.length - 1;
}

// 加载语录
const quotes = require('./data/quotes.json');

function getRandomQuote() {
  return quotes[Math.floor(Math.random() * quotes.length)];
}

// ---------- 页面路由 ----------
app.get('/', (req, res) => {
  const quotesForPage = quotes.slice(0, 3);
  const quote = getRandomQuote();
  res.render('index.ejs', {
    loggedIn: !!req.session.userId,
    quote,
    quotes: quotesForPage,
    user: req.session.userId ? db.getUserById(req.session.userId) : null,
  });
});

app.get('/game', requireAuth, (req, res) => {
  const quote = getRandomQuote();
  res.render('game.ejs', {
    user: db.getUserById(req.session.userId),
    quote,
    ranges: em.MARKET_CAP_RANGES,
  });
});

app.get('/ranking', (req, res) => {
  const uniRanking = db.getUniversityRanking();
  const indRanking = db.getIndividualRanking();
  const quote = getRandomQuote();
  res.render('ranking.ejs', {
    loggedIn: !!req.session.userId,
    user: req.session.userId ? db.getUserById(req.session.userId) : null,
    uniRanking, indRanking, quote,
  });
});

// ---------- 认证 API ----------
app.get('/api/universities', (req, res) => {
  const db2 = db.getDB();
  const unis = db2.prepare('SELECT * FROM universities ORDER BY name').all();
  res.json(unis);
});

app.get('/api/quote', (req, res) => {
  res.json(getRandomQuote());
});

app.post('/api/register', (req, res) => {
  const { username, password, university_id } = req.body;
  if (!username || !password || !university_id) {
    return res.status(400).json({ error: '请填写所有字段' });
  }
  if (username.length < 2 || password.length < 4) {
    return res.status(400).json({ error: '用户名至少2位，密码至少4位' });
  }
  try {
    const hash = hashPassword(password);
    const result = db.createUser(username, hash, parseInt(university_id));
    req.session.userId = result.lastInsertRowid;
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '用户名已存在' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.userId = user.id;
  res.json({ success: true, username: user.username });
});

app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json(null);
  const user = db.getUserById(req.session.userId);
  res.json(user);
});

// ---------- 游戏 API ----------

// 当前游戏会话（查找用户进行中的游戏）
app.get('/api/game/current', requireAuth, (req, res) => {
  const db2 = db.getDB();
  const session = db2.prepare(
    "SELECT * FROM game_sessions WHERE user_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1"
  ).get(req.session.userId);

  if (!session) {
    return res.json({ noSession: true });
  }

  // 获取当前轮次信息
  const round = db.getRoundBySessionAndNumber(session.id, session.current_round);
  res.json({ session, round });
});

// 创建新游戏 / 下一轮数据准备
async function prepareRound(sessionId, roundNumber, userId) {
  // 获取已用过的股票代码
  const db2 = db.getDB();
  const usedRounds = db2.prepare('SELECT stock_code FROM game_rounds WHERE session_id = ?').all(sessionId);
  const usedCodes = usedRounds.map(r => r.stock_code);

  // 随机选股 + 获取上市年份，确保数据可用
  let stock, fin, year;
  for (let attempt = 0; attempt < 5; attempt++) {
    stock = em.pickRandomStock(stocksCache, usedCodes);
    if (!stock) return { error: '没有更多股票了' };
    usedCodes.push(stock.code);

    // 获取公司简介（含上市日期）
    const profile = await em.fetchCompanyProfile(stock.code);
    let earliestYear = 2021;
    if (profile?.listingDate) {
      const listYear = parseInt(profile.listingDate.slice(0, 4));
      if (!isNaN(listYear)) earliestYear = Math.max(listYear + 1, 2021);
    }

    // 在有效年份范围内随机选
    if (earliestYear <= 2025) {
      year = earliestYear + Math.floor(Math.random() * (2026 - earliestYear));
      fin = await em.fetchAnnualFinancialData(stock.code, year);

      // 额外检查：1年后的日期不能是未来（确保有1年后股价数据）
      if (fin && fin.noticeDate) {
        const oneYearLater = new Date(fin.noticeDate);
        oneYearLater.setDate(oneYearLater.getDate() + 365);
        if (oneYearLater > new Date()) {
          fin = null; // 1年后数据尚未产生，换一只
        }
      }
      if (fin) break;
    }
  }

  if (!fin) return { error: '获取财务数据失败，请重试' };

  const roundId = db.createRound(sessionId, roundNumber, stock.code, fin.companyName, year, 100).lastInsertRowid;
  return { roundId, stock, fin, year };
}

// 获取行业描述
async function getIndustryInfo(code) {
  try {
    const industry = await em.fetchIndustryDescription(code);
    return industry || '未知行业';
  } catch {
    return '未知行业';
  }
}

// 新建游戏
app.post('/api/game/new', requireAuth, async (req, res) => {
  try {
    // 先检查是否有进行中的游戏
    const db2 = db.getDB();
    const existing = db2.prepare(
      "SELECT * FROM game_sessions WHERE user_id = ? AND status = 'in_progress' LIMIT 1"
    ).get(req.session.userId);

    let sessionId;
    if (existing) {
      sessionId = existing.id;
      // 有进行中的游戏，重置（但保留资产）
      db2.prepare('DELETE FROM game_rounds WHERE session_id = ?').run(sessionId);
      db2.prepare("UPDATE game_sessions SET current_round = 0, rounds = 1, status = 'in_progress' WHERE id = ?").run(sessionId);
    } else {
      // 从上一次完成游戏的最终资产开始
      const lastAsset = db.getLastFinishedAsset(req.session.userId);
      db2.prepare('INSERT INTO game_sessions (user_id, asset_pct, rounds) VALUES (?, ?, 1)').run(req.session.userId, lastAsset);
      sessionId = db2.prepare('SELECT last_insert_rowid() as id').get().id;
    }

    const roundData = await prepareRound(sessionId, 1, req.session.userId);
    if (roundData.error) {
      return res.status(500).json({ error: roundData.error });
    }

    // 更新 current_round 为 1
    db.incrementRound(sessionId);

    // 获取行业和公司简介
    const industry = await getIndustryInfo(roundData.stock.code);
    const profile = await em.fetchCompanyProfile(roundData.stock.code);
    const mainBusiness = profile ? em.anonymize(profile.mainBusiness, profile.companyName) : '';
    const orgProfile = profile ? profile.orgProfile : '';

    // 更新轮次记录中的初始资产
    const session = db.getSession(sessionId);
    db2.prepare('UPDATE game_rounds SET asset_before = ? WHERE id = ?').run(session.asset_pct, roundData.roundId);

    // 返回匿名数据（不含公司名）
    const fin = roundData.fin;
    res.json({
      sessionId,
      roundNumber: 1,
      assetPct: Math.round(session.asset_pct * 100) / 100,
      year: roundData.year,
      financials: {
        // 利润表
        revenue: fin.revenue, grossProfit: fin.grossProfit, grossMargin: fin.grossMargin,
        netProfit: fin.netProfit, deductedNetProfit: fin.deductedNetProfit, netMargin: fin.netMargin,
        revenueYoy: fin.revenueYoy, revenueQoq: fin.revenueQoq,
        netProfitYoy: fin.netProfitYoy, netProfitQoq: fin.netProfitQoq, deductedNetProfitYoy: fin.deductedNetProfitYoy,
        eps: fin.eps, epsDeducted: fin.epsDeducted, epsDiluted: fin.epsDiluted,
        // 资产负债表
        totalAssets: fin.totalAssets, totalEquity: fin.totalEquity, totalLiabilities: fin.totalLiabilities,
        debtRatio: fin.debtRatio, equityRatio: fin.equityRatio,
        bps: fin.bps, capReservePerShare: fin.capReservePerShare, retainedEarningsPerShare: fin.retainedEarningsPerShare,
        currentRatio: fin.currentRatio, quickRatio: fin.quickRatio,
        assetTurnover: fin.assetTurnover, inventoryTurnover: fin.inventoryTurnover, receivablesTurnover: fin.receivablesTurnover,
        assetTurnoverDays: fin.assetTurnoverDays, inventoryTurnoverDays: fin.inventoryTurnoverDays, receivablesTurnoverDays: fin.receivablesTurnoverDays,
        // 现金流量表
        operatingCashFlow: fin.operatingCashFlow, cfPerShare: fin.cfPerShare, cfRatio: fin.cfRatio,
        cashToRevenue: fin.cashToRevenue, ocfToRevenue: fin.ocfToRevenue,
        // 盈利能力
        roe: fin.roe, roeDeducted: fin.roeDeducted, roic: fin.roic, roa: fin.roa, taxRate: fin.taxRate,
      },
      industry,
      mainBusiness,
      ranges: em.MARKET_CAP_RANGES,
    });
  } catch (e) {
    console.error('创建游戏失败:', e);
    res.status(500).json({ error: '创建游戏失败，请重试' });
  }
});

// 猜市值
app.post('/api/game/:id/guess', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = db.getSession(sessionId);
    if (!session || session.user_id !== req.session.userId) {
      return res.status(404).json({ error: '游戏不存在' });
    }

    const { range_id } = req.body;
    const round = db.getRoundBySessionAndNumber(sessionId, session.current_round);
    if (!round) return res.status(400).json({ error: '没有进行中的轮次' });

    // 确保本局游戏还未出结果 — 避免重复猜
    if (round.guessed_range_id !== null) {
      return res.status(400).json({ error: '本轮已经猜过了' });
    }

    // 获取年报发布日附近的股价
    const fin = await em.fetchAnnualFinancialData(round.stock_code, round.year);
    if (!fin || !fin.noticeDate) {
      return res.status(500).json({ error: '获取股价数据失败' });
    }

    // 获取年报发布后首个交易日的股价
    const priceData = await em.fetchStockPriceNear(round.stock_code, fin.noticeDate, 10);
    if (!priceData) {
      return res.status(500).json({ error: '获取股价失败' });
    }

    // 计算市值（亿元）= 股价 × 总股本 / 1e8
    const marketCapYi = em.yuanToYi(priceData.close * fin.totalShares);
    const correctRange = pickRange(marketCapYi);
    const isCorrect = range_id === correctRange;

    // 更新轮次记录
    db.updateRoundGuess(round.id, range_id, isCorrect);

    // 获取行业和公司简介
    const industry = await getIndustryInfo(round.stock_code);
    const profile = await em.fetchCompanyProfile(round.stock_code);
    const orgProfile = profile ? profile.orgProfile : '';

    res.json({
      correct: isCorrect,
      guessedRangeId: range_id,
      correctRangeId: correctRange,
      companyName: round.stock_name,
      stockCode: round.stock_code,
      industry,
      marketCapYi: Math.round(marketCapYi),
      stockPrice: priceData.close,
      priceDate: priceData.date,
      orgProfile,
      ranges: em.MARKET_CAP_RANGES,
    });
  } catch (e) {
    console.error('猜市值失败:', e);
    res.status(500).json({ error: '操作失败' });
  }
});

// 买入/不买决策
app.post('/api/game/:id/decide', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = db.getSession(sessionId);
    if (!session || session.user_id !== req.session.userId) {
      return res.status(404).json({ error: '游戏不存在' });
    }

    const { bought } = req.body; // 1=买入, 0=不买
    const round = db.getRoundBySessionAndNumber(sessionId, session.current_round);
    if (!round) return res.status(400).json({ error: '没有进行中的轮次' });

    if (round.bought !== 0) {
      return res.status(400).json({ error: '已经做出过决策' });
    }

    const fin = await em.fetchAnnualFinancialData(round.stock_code, round.year);
    if (!fin || !fin.noticeDate) {
      return res.status(500).json({ error: '获取数据失败' });
    }

    // 获取年报发布后首日股价
    const entryPrice = await em.fetchStockPriceNear(round.stock_code, fin.noticeDate, 10);
    if (!entryPrice) {
      return res.status(500).json({ error: '获取股价失败' });
    }

    // 获取1年后股价（约365天后）
    const noticeDate = new Date(fin.noticeDate);
    const oneYearLater = new Date(noticeDate);
    oneYearLater.setDate(oneYearLater.getDate() + 365);
    const exitDate = oneYearLater.toISOString().split('T')[0];
    let exitPrice = await em.fetchStockPriceNear(round.stock_code, exitDate, 15);

    // 如果找不到，再往后找
    if (!exitPrice) {
      const later = new Date(oneYearLater);
      later.setDate(later.getDate() + 15);
      exitPrice = await em.fetchStockPriceNear(round.stock_code, later.toISOString().split('T')[0], 10);
    }

    const exitPriceVal = exitPrice ? exitPrice.close : entryPrice.close;
    const exitPriceDate = exitPrice ? exitPrice.date : entryPrice.date;

    // 计算收益率（无论是否买入都算，用于展示）
    const actualReturn = (exitPriceVal - entryPrice.close) / entryPrice.close;
    let roundReturn = 0;
    if (bought) {
      roundReturn = actualReturn;
    }

    // 更新资产
    const assetBefore = parseFloat(session.asset_pct);
    const assetAfter = bought ? assetBefore * (1 + roundReturn) : assetBefore;

    db.updateRoundDecision(round.id, bought ? 1 : 0, assetAfter, roundReturn);
    db.updateSessionAsset(sessionId, assetAfter);
    db.completeSession(sessionId);  // 1轮游戏，决策即结束

    res.json({
      bought: bought ? 1 : 0,
      entryPrice: entryPrice.close,
      entryDate: entryPrice.date,
      exitPrice: exitPriceVal,
      exitDate: exitPriceDate,
      roundReturn: roundReturn,
      actualReturn: actualReturn,
      assetBefore: Math.round(assetBefore * 100) / 100,
      assetAfter: Math.round(assetAfter * 100) / 100,
    });
  } catch (e) {
    console.error('决策失败:', e);
    res.status(500).json({ error: '操作失败' });
  }
});

// 下一轮
app.post('/api/game/:id/next', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = db.getSession(sessionId);
    if (!session || session.user_id !== req.session.userId) {
      return res.status(404).json({ error: '游戏不存在' });
    }

    // 检查当前轮是否已完成决策
    const currentRound = db.getRoundBySessionAndNumber(sessionId, session.current_round);
    if (currentRound && currentRound.round_return === null) {
      return res.status(400).json({ error: '请先完成当前轮次的决策' });
    }

    // 增加轮次
    db.incrementRound(sessionId);
    const updatedSession = db.getSession(sessionId);

    // 检查是否完成所有轮次
    if (updatedSession.current_round > updatedSession.rounds) {
      db.completeSession(sessionId);
      // 获取所有轮次记录
      const rounds = db.getSessionRounds(sessionId);
      return res.json({
        finished: true,
        finalAsset: Math.round(updatedSession.asset_pct * 100) / 100,
        rounds,
      });
    }

    // 准备下一轮
    const roundData = await prepareRound(sessionId, updatedSession.current_round, req.session.userId);
    if (roundData.error) {
      // 没有更多股票了，提前结束
      db.completeSession(sessionId);
      const rounds = db.getSessionRounds(sessionId);
      return res.json({
        finished: true,
        finalAsset: Math.round(updatedSession.asset_pct * 100) / 100,
        rounds,
      });
    }

    // 更新轮次中的资产
    const db2 = db.getDB();
    db2.prepare('UPDATE game_rounds SET asset_before = ? WHERE id = ?').run(updatedSession.asset_pct, roundData.roundId);

    const industry = await getIndustryInfo(roundData.stock.code);
    const profile = await em.fetchCompanyProfile(roundData.stock.code);
    const mainBusiness = profile ? em.anonymize(profile.mainBusiness, profile.companyName) : '';
    const fin = roundData.fin;

    res.json({
      finished: false,
      sessionId,
      roundNumber: updatedSession.current_round,
      year: roundData.year,
      financials: {
        // 利润表
        revenue: fin.revenue, grossProfit: fin.grossProfit, grossMargin: fin.grossMargin,
        netProfit: fin.netProfit, deductedNetProfit: fin.deductedNetProfit, netMargin: fin.netMargin,
        revenueYoy: fin.revenueYoy, revenueQoq: fin.revenueQoq,
        netProfitYoy: fin.netProfitYoy, netProfitQoq: fin.netProfitQoq, deductedNetProfitYoy: fin.deductedNetProfitYoy,
        eps: fin.eps, epsDeducted: fin.epsDeducted, epsDiluted: fin.epsDiluted,
        // 资产负债表
        totalAssets: fin.totalAssets, totalEquity: fin.totalEquity, totalLiabilities: fin.totalLiabilities,
        debtRatio: fin.debtRatio, equityRatio: fin.equityRatio,
        bps: fin.bps, capReservePerShare: fin.capReservePerShare, retainedEarningsPerShare: fin.retainedEarningsPerShare,
        currentRatio: fin.currentRatio, quickRatio: fin.quickRatio,
        assetTurnover: fin.assetTurnover, inventoryTurnover: fin.inventoryTurnover, receivablesTurnover: fin.receivablesTurnover,
        assetTurnoverDays: fin.assetTurnoverDays, inventoryTurnoverDays: fin.inventoryTurnoverDays, receivablesTurnoverDays: fin.receivablesTurnoverDays,
        // 现金流量表
        operatingCashFlow: fin.operatingCashFlow, cfPerShare: fin.cfPerShare, cfRatio: fin.cfRatio,
        cashToRevenue: fin.cashToRevenue, ocfToRevenue: fin.ocfToRevenue,
        // 盈利能力
        roe: fin.roe, roeDeducted: fin.roeDeducted, roic: fin.roic, roa: fin.roa, taxRate: fin.taxRate,
      },
      industry,
      mainBusiness,
      ranges: em.MARKET_CAP_RANGES,
    });
  } catch (e) {
    console.error('下一轮失败:', e);
    res.status(500).json({ error: '操作失败' });
  }
});

// 游戏结果
app.get('/api/game/:id/result', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  const session = db.getSession(sessionId);
  if (!session || session.user_id !== req.session.userId) {
    return res.status(404).json({ error: '游戏不存在' });
  }
  const rounds = db.getSessionRounds(sessionId);
  res.json({
    session,
    rounds,
    finalAsset: Math.round(session.asset_pct * 100) / 100,
  });
});

// ---------- 排行榜 API ----------
app.get('/api/ranking', (req, res) => {
  const uniRanking = db.getUniversityRanking();
  const indRanking = db.getIndividualRanking();
  res.json({ uniRanking, indRanking });
});

// 获取当前资产
app.get('/api/asset', requireAuth, (req, res) => {
  const session = db.getDB().prepare(
    "SELECT asset_pct FROM game_sessions WHERE user_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1"
  ).get(req.session.userId);
  if (session) {
    res.json({ asset: Math.round(session.asset_pct * 100) / 100 });
  } else {
    const lastAsset = db.getLastFinishedAsset(req.session.userId);
    res.json({ asset: Math.round(lastAsset * 100) / 100 });
  }
});

// ---------- 启动 ----------
app.listen(PORT, () => {
  console.log(`✅ 我真不是股神啊 - http://localhost:${PORT}`);
});
