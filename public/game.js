/**
 * 游戏前端状态机
 */

function yuanYi(v) { return (v !== null && v !== undefined) ? (v / 1e8).toFixed(2) + ' 亿' : '--'; }
function pct(v) { return (v !== null && v !== undefined) ? v.toFixed(2) + '%' : '--'; }
function num(v, d) { return (v !== null && v !== undefined) ? Number(v).toFixed(d || 2) : '--'; }
function fmtPrice(p) { return p ? '¥' + p.toFixed(2) : '--'; }

let currentData = {};
let isFirstGame = true;

function showPhase(id) {
  document.querySelectorAll('.phase').forEach(p => p.style.display = 'none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

// 更新导航栏资产
function updateNavAsset(val) {
  const el = document.getElementById('navAsset');
  if (el) el.innerHTML = '资产: <span class="nav-asset-value">' + val.toFixed(1) + '</span>%';
  const ge = document.querySelector('#gameAsset .asset-value');
  if (ge) ge.textContent = val.toFixed(1) + '%';
}

// ===== 开始新游戏 =====
async function startGame() {
  document.getElementById('gameStart').style.display = 'none';
  document.getElementById('gameLoading').style.display = '';

  try {
    const res = await fetch('/api/game/new', { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      document.getElementById('gameLoading').style.display = 'none';
      document.getElementById('gameStart').style.display = '';
      return;
    }

    gameState.sessionId = data.sessionId;
    gameState.assetPct = data.assetPct || 100;

    document.getElementById('gameLoading').style.display = 'none';
    document.getElementById('gamePlay').style.display = '';
    renderFinancials(data);
  } catch (e) {
    alert('网络错误，请重试');
    document.getElementById('gameLoading').style.display = 'none';
    document.getElementById('gameStart').style.display = '';
  }
}

// ===== 阶段1: 展示三大报表 =====
function renderFinancials(data) {
  currentData = data;
  const f = data.financials;

  document.getElementById('financialYearHint').textContent =
    '该企业 ' + data.year + ' 年财务数据，根据三大报表推测其年报后市值';
  document.getElementById('industryText').textContent = data.industry || '未知行业';

  // 匿名主营业务描述
  const mainBizEl = document.getElementById('mainBusinessText');
  const mainBizBox = document.getElementById('mainBusinessBox');
  if (data.mainBusiness) {
    mainBizEl.textContent = data.mainBusiness;
    mainBizBox.style.display = '';
  } else {
    mainBizBox.style.display = 'none';
  }

  document.getElementById('gameProgress').textContent = isFirstGame ? '首次挑战' : '再次挑战';
  updateNavAsset(gameState.assetPct);

  // ========== 三大报表区 ==========
  const statements = [
    {
      title: '利润表',
      items: [
        ['营业总收入', yuanYi(f.revenue)],
        ['毛利润', yuanYi(f.grossProfit)],
        ['营收同比增长', pct(f.revenueYoy)],
        ['营收环比增长', pct(f.revenueQoq)],
        ['归母净利润', yuanYi(f.netProfit)],
        ['扣非净利润', yuanYi(f.deductedNetProfit)],
        ['净利润同比增长', pct(f.netProfitYoy)],
        ['净利润环比增长', pct(f.netProfitQoq)],
        ['扣非净利润同比', pct(f.deductedNetProfitYoy)],
        ['基本每股收益 (EPS)', num(f.eps) + ' 元'],
        ['扣非每股收益', num(f.epsDeducted) + ' 元'],
        ['稀释每股收益', num(f.epsDiluted) + ' 元'],
      ]
    },
    {
      title: '资产负债表',
      items: [
        ['总资产', yuanYi(f.totalAssets)],
        ['总负债', yuanYi(f.totalLiabilities)],
        ['净资产（股东权益）', yuanYi(f.totalEquity)],
        ['资产负债率', pct(f.debtRatio)],
        ['产权比率', num(f.equityRatio, 2)],
        ['每股净资产 (BPS)', num(f.bps) + ' 元'],
        ['每股资本公积', num(f.capReservePerShare) + ' 元'],
        ['每股未分配利润', num(f.retainedEarningsPerShare) + ' 元'],
        ['流动比率', num(f.currentRatio, 2)],
        ['速动比率', num(f.quickRatio, 2)],
        ['总资产周转率', num(f.assetTurnover, 4) + ' 次'],
        ['存货周转率', num(f.inventoryTurnover, 4) + ' 次'],
        ['应收账款周转率', num(f.receivablesTurnover, 2) + ' 次'],
        ['总资产周转天数', num(f.assetTurnoverDays, 1) + ' 天'],
        ['存货周转天数', num(f.inventoryTurnoverDays, 1) + ' 天'],
        ['应收账款周转天数', num(f.receivablesTurnoverDays, 2) + ' 天'],
      ]
    },
    {
      title: '现金流量表',
      items: [
        ['经营活动现金流净额', yuanYi(f.operatingCashFlow)],
        ['每股经营现金流', num(f.cfPerShare) + ' 元'],
        ['现金流量比率', num(f.cfRatio, 2)],
        ['销售现金流 / 营业收入', num(f.cashToRevenue, 4)],
        ['经营现金流 / 营业收入', num(f.ocfToRevenue, 4)],
      ]
    }
  ];

  // ========== 核心财务指标区 ==========
  const indicators = [
    { label: '加权净资产收益率 (ROE)', value: pct(f.roe) },
    { label: '扣非净资产收益率', value: pct(f.roeDeducted) },
    { label: '投入资本回报率 (ROIC)', value: pct(f.roic) },
    { label: '总资产净利率 (ROA)', value: pct(f.roa) },
    { label: '销售毛利率', value: pct(f.grossMargin) },
    { label: '销售净利率', value: pct(f.netMargin) },
    { label: '实际税率', value: pct(f.taxRate) },
  ];

  // 渲染三大报表
  let finHtml = statements.map(s => `
    <div class="statement-section">
      <div class="statement-title">${s.title}</div>
      <div class="statement-grid">
        ${s.items.map(item => `
          <div class="statement-item">
            <span class="statement-label">${item[0]}</span>
            <span class="statement-value${item[1] === '--' ? ' muted' : ''}">${item[1]}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // 渲染核心财务指标
  finHtml += `
    <div class="statement-section">
      <div class="statement-title">核心财务指标</div>
      <div class="statement-grid">
        ${indicators.map(item => `
          <div class="statement-item">
            <span class="statement-label">${item.label}</span>
            <span class="statement-value">${item.value}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('financialStatements').innerHTML = finHtml;

  showPhase('phaseFinancials');
}

// ===== 阶段2: 猜市值 =====
function showGuessPhase() {
  const container = document.getElementById('rangeButtons');
  const ranges = currentData.ranges || RANGES;
  container.innerHTML = '';
  ranges.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'range-btn';
    btn.textContent = r.label;
    btn.onclick = () => submitGuess(r.id);
    container.appendChild(btn);
  });
  showPhase('phaseGuess');
}

async function submitGuess(rangeId) {
  document.querySelectorAll('.range-btn').forEach(b => b.style.pointerEvents = 'none');

  try {
    const res = await fetch('/api/game/' + gameState.sessionId + '/guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range_id: rangeId }),
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }

    document.querySelectorAll('.range-btn').forEach((btn, i) => {
      if (i === data.correctRangeId) btn.classList.add('correct');
      else if (i === data.guessedRangeId && !data.correct) btn.classList.add('wrong');
    });

    setTimeout(() => renderReveal(data), 600);
  } catch (e) {
    alert('网络错误');
  }
}

// ===== 阶段3: 揭晓公司 =====
function renderReveal(data) {
  document.getElementById('revealCompany').textContent = data.companyName;
  document.getElementById('revealCode').textContent = data.stockCode;
  document.getElementById('revealIndustry').textContent = data.industry || '未知';

  const capYi = data.marketCapYi;
  const rangeLabel = data.ranges[data.correctRangeId].label;
  document.getElementById('revealMarketCap').innerHTML =
    '<span class="reveal-value">' + capYi.toLocaleString() + ' 亿</span>' +
    ' <span style="color:#94a3b8;font-size:0.82rem">(' + rangeLabel + ')</span>';
  document.getElementById('revealPrice').textContent = fmtPrice(data.stockPrice) + ' (' + data.priceDate + ')';

  // 公司简介（揭晓后展示）
  const profileEl = document.getElementById('revealProfile');
  const profileBox = document.getElementById('revealProfileBox');
  if (data.orgProfile) {
    profileEl.textContent = data.orgProfile;
    profileBox.style.display = '';
  } else {
    profileBox.style.display = 'none';
  }

  const verdict = document.getElementById('revealVerdict');
  if (data.correct) {
    verdict.innerHTML = '判断正确，你对公司规模的把握很准';
    verdict.style.color = 'var(--success)';
  } else {
    verdict.innerHTML = '实际在 ' + rangeLabel + ' 区间';
    verdict.style.color = 'var(--danger)';
  }

  showPhase('phaseReveal');
}

// ===== 阶段4: 买入决策 =====
function showDecisionPhase() {
  document.querySelectorAll('.btn-buy, .btn-pass').forEach(b => {
    b.style.pointerEvents = '';
    b.style.opacity = '1';
  });
  showPhase('phaseDecision');
}

async function makeDecision(bought) {
  document.querySelectorAll('.btn-buy, .btn-pass').forEach(b => b.style.pointerEvents = 'none');

  try {
    const res = await fetch('/api/game/' + gameState.sessionId + '/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bought }),
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    renderResult(data);
  } catch (e) {
    alert('网络错误');
  }
}

// ===== 阶段5: 结果 =====
function renderResult(data) {
  const box = document.getElementById('resultBox');

  if (data.bought) {
    const pos = data.roundReturn >= 0;
    box.innerHTML =
      '<p style="font-size:0.9rem;margin-bottom:8px;color:#64748b">你选择了全仓买入</p>' +
      '<p style="font-size:0.82rem;color:#94a3b8;margin-bottom:8px">' +
        '买入价: ' + fmtPrice(data.entryPrice) + ' (' + data.entryDate + ')<br>' +
        '一年后价: ' + fmtPrice(data.exitPrice) + ' (' + data.exitDate + ')' +
      '</p>' +
      '<div class="result-return ' + (pos ? 'positive' : 'negative') + '">' +
        (pos ? '↑' : '↓') + ' ' + (data.roundReturn * 100).toFixed(2) + '%' +
      '</div>';
  } else {
    const up = data.actualReturn > 0;
    box.innerHTML =
      '<p style="font-size:0.9rem;margin-bottom:8px;color:#64748b">你选择了不买</p>' +
      '<p style="font-size:0.82rem;color:#94a3b8;margin-bottom:8px">' +
        '该股从 ' + fmtPrice(data.entryPrice) + ' (' + data.entryDate + ')' +
        ' → ' + fmtPrice(data.exitPrice) + ' (' + data.exitDate + ')' +
      '</p>' +
      '<div style="font-size:1rem;color:' + (up ? 'var(--success)' : 'var(--danger)') + '">' +
        (up ? '↑' : '↓') + ' 实际涨幅: ' + (data.actualReturn * 100).toFixed(2) + '%' +
      '</div>';
  }

  gameState.assetPct = data.assetAfter;
  updateNavAsset(data.assetAfter);

  const color = data.assetAfter > data.assetBefore ? 'var(--success)' :
    data.assetAfter < data.assetBefore ? 'var(--danger)' : 'var(--text)';
  document.getElementById('assetUpdate').innerHTML =
    '<span style="font-size:1.3rem;font-weight:600;color:' + color + '">' +
      data.assetBefore.toFixed(1) + '% → ' + data.assetAfter.toFixed(1) + '%' +
    '</span>';

  showPhase('phaseResult');
}

// ===== 查看结果 → 继续/退出 =====
function showPostGameActions() {
  const result = document.getElementById('finalResult');
  const pct = gameState.assetPct;
  const isGood = pct >= 100;
  result.innerHTML =
    '<p class="final-label">当前资产</p>' +
    '<div class="final-asset" style="color:' + (isGood ? 'var(--success)' : 'var(--danger)') + '">' +
      pct.toFixed(1) + '%' +
    '</div>' +
    '<p style="font-size:0.9rem;color:#64748b">' +
      (isGood ? '收益为正，你的判断经受住了市场的检验。' : '投资需要耐心和纪律，下次会更好。') +
    '</p>';

  updateQuote();
  document.getElementById('postGameHint').textContent =
    '资产 ' + pct.toFixed(1) + '%，选择继续挑战或返回首页：';
  showPhase('phasePostGame');
}

// ===== 继续或退出 =====
function continueGame() {
  isFirstGame = false;
  document.getElementById('gamePlay').style.display = 'none';
  document.getElementById('gameLoading').style.display = '';
  startGame();
}

// ===== 语录更新 =====
async function updateQuote() {
  try {
    const res = await fetch('/api/quote');
    const q = await res.json();
    document.getElementById('quoteBar').innerHTML =
      '<span class="quote-text">"' + q.text + '"</span>' +
      '<span class="quote-source">— ' + q.source + '</span>';
  } catch {}
}

// ===== 页面初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gameLoading').style.display = 'none';
  document.getElementById('gameStart').style.display = '';

  // 加载资产到导航
  fetch('/api/asset').then(r => r.json()).then(d => {
    if (d.asset !== undefined) updateNavAsset(d.asset);
  }).catch(() => {});
});
