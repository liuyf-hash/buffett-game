# 我真不是股神啊

巴菲特主题 A 股价值投资教育游戏。

## 快速启动

```bash
cd "C:\Users\LYF\Desktop\test6.3\分析财务报表"
npm install
node app.js
# 打开 http://localhost:3000
```

首次启动会自动从东方财富缓存 5534 只 A 股到 `data/stocks.json`（约 2MB）。

## 项目结构

```
分析财务报表/
├── app.js              # Express 服务器（所有路由）
├── db.js               # SQLite 数据库（用户/游戏记录）
├── eastmoney.js        # 东方财富 API 封装
├── fetch-stocks.js     # 手动更新A股列表
├── views/
│   ├── index.ejs       # 首页 + 登录/注册
│   ├── game.ejs        # 游戏页面
│   └── ranking.ejs     # 排行榜
├── public/
│   ├── style.css       # 巴菲特绿金主题
│   └── game.js         # 游戏前端逻辑
└── data/
    ├── stocks.json     # A股代码列表（5534只）
    ├── universities.json
    └── quotes.json     # 巴菲特语录
```

## 游戏玩法

1. **注册/登录** — 选择你的大学（仅国内公立一本）
2. **开始挑战** — 系统随机抽取一只 A 股 + 随机年份
3. **看财报** — 匿名展示营收、净利、资产、负债、经营现金流
4. **猜市值** — 7 档区间选择
5. **揭晓** — 公司身份 + 真实市值 + 年报后首日股价
6. **决策** — 全仓买入持有 1 年 / 不买
7. **结果** — 1 年后股价 + 收益率 + 资产更新
8. **10 轮后** — 显示最终资产，记录排行榜

所有财务数据由东方财富免费 API 实时提供，不存数据库。

## 技术栈

- Node.js (内置 fetch + node:sqlite)
- Express + EJS
- SQLite（仅存用户和游戏记录）
- 东方财富免费 API（无需 Key）

## 排行榜

- 大学排名 — 按平均最终资产排序
- 个人排名 — 按最佳成绩排序
