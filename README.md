<div align="center">

# 7连翻助手

**点牌算分，累计到 200 不烧心**

《7连翻》（Flip 7）和《7连翻：冤家路窄》（Flip 7: With a Vengeance）线下对局的多人同步工具：每轮点选面前的牌自动算分、累计总分、自动判定 200 分终局和平局加赛。

一桌人用手机扫码进同一个房间，所有操作实时同步，无需下载、无需注册。

**[立即使用 → flip7.leisurecat.cloud](https://flip7.leisurecat.cloud)**

</div>

---

## 为什么做

调研见 `docs/`（中英文社区调研、做与不做清单，2026-11-13 用户确认）。要点：

- 玩家最大的痛点是记分：要打很多轮、累计到 200 分，盒子里却没有计分纸。官方计分网页一刷新就丢分。
- 最常吵的是算分顺序（×2 和加分牌先算哪个），以及连翻三张途中翻到行动牌怎么办。
- 牌、发牌、翻牌留在线下；本站只做录分、算分、累计、判胜负和讲规则。

## 功能

### 房间和开局

- 建房时选《7连翻》原版或《冤家路窄》，冤家路窄可开「残酷模式」（规则书第 7 页）。总入口用 `/?v=base`、`/?v=veng` 预选版本。
- 每人在自己手机上加入；没带手机的人可以由别人代加。按座位顺时针排好，选第一个发牌人（「定先后手」跳总入口的手指轮盘 / 抽签）。之后每轮自动轮到左手边的人发牌。
- 1～2 人也能开：规则书最后一页的挑战，看几轮打到 200 分。

### 每轮录分

- **点牌算分**：点选面前的牌（图片截自官方规则书），自动算分并显示算式。
  - 原版：数字牌之和 → ×2 → 加 +2～+10 → 七连翻 +15（官方 FAQ：×2 只翻倍数字牌）。
  - 冤家路窄：数字牌之和 → ÷2（向下取整）→ 减 −2～−10（最低 0，残酷模式可以为负）→ 七连翻 +15。零号牌：不七连翻就 0 分；厄运 7 和普通 7 不能同时有；幸运 13 允许两张 13。
  - 残酷模式下七连翻的人可以选「扣某人 15 分」。
- **直接填总分**，或者点「爆了」。
- 谁没录会高亮；全员录完才能「本轮结束」。同一轮录了超过整副牌张数的牌（如两人都有 ×2）、或者两人都七连翻，会提示核对，只提示不拦着。
- 撤销上一轮；「逐轮得分」里点任何一格都能改。分数存在服务端，刷新、断线、切出微信都不丢。

### 终局

- 一轮结束时有人到 200 分、并且最高分只有一人，游戏结束；最高分并列时提示全员加赛一轮（官方 FAQ）。改过去的分也会重新判定。
- 结算页：排名、七连翻 / 爆牌次数、单轮最高、成就、逐轮得分表、存长图、写评价（两个版本都用 game `flip7`，总入口只有一个盒子；冤家路窄的评价文字前自动加“（冤家路窄）”）。「再来一局」保留同一批人，下一位先发牌。
- 往期对局（`/history`）：按玩家名或房间码搜索。

### N 分钟讲规则（`/teach`）

原版「2 分钟讲规则」、冤家路窄「3 分钟讲规则」，页面上方切换，每台手机记住自己的选择。

- 讲稿分五段，每个重要要素一句话点到；段末「桌上常见疑问」一键问规则助手。
- 「注意事项」原版 17 条、冤家路窄 14 条，每条写好答案（依据规则书、官方 FAQ、The Op 员工在 BGG 的答复，社区共识会注明），默认收起。
- 讲稿里带下划线的词点开看卡牌图和解释；页面底部「卡牌速查」列出整副牌和张数。
- 卡牌图截自 The Op 官方规则书（《Flip 7》Ruleset 3.1、《With a Vengeance》Ruleset Edition 1），600 dpi 渲染后裁剪，压成 webp（`public/img/c/`，51 张约 200 KB），页脚署名并链接原文。
- 原版牌名用简中正版用词（不许动、连翻三张、卷土重来，印在中文版盒子上）；冤家路窄的中文规则书没拿到，牌名用中文玩家的常用叫法并附英文名。

### 规则助手

每个页面右下角「规则」：只依据本站讲稿（`tools/讲解稿.md`）和常见问题（`tools/faq.json`）作答；资料里没有的，会联网查（先搜 BGG），回答标明「本站未核对」并列出来源。两个版本规则不同：在房间里或讲规则页上提问时，问题前会自动加上（版本：原版 / 冤家路窄）。模型顺序和切换规则与系列其他站相同；DeepSeek 不通的状态读匹兹堡站每小时检查后写进的 KV（本站不设 cron）。

**要用规则助手，先设置密钥**：`wrangler secret put DEEPSEEK_API_KEY --name flip7-helper`

讲稿和常见问题都由讲规则页的数据生成，改完 `public/teach-data.js` 或 `tools/faq_extra.json` 后运行：

```bash
node tools/make_guide.mjs
```

## 技术实现

纯前端页面 + Cloudflare Workers，没有构建步骤，没有框架。

| 部分 | 说明 |
|---|---|
| `public/logic.js` | 规则与状态（算分、发牌人轮换、终局判定、核对提醒、成就），页面和服务端共用，服务端权威校验 |
| `public/app.js` | 房间页面，DOM `morph()` 增量渲染 |
| `public/teach-data.js`、`teach.js`、`teach.html` | 讲规则页（讲稿、注意事项、卡牌速查的数据都在 `teach-data.js`） |
| `public/chat.js` | 规则助手悬浮窗 |
| `src/worker.js` | 建房接口；`Room`（每个房间一个 Durable Object，WebSocket 同步）；`Lobby`（首页房间列表）；`Archive`（往期对局）；`/api/chat` 规则助手 |
| `public/vendor/` | [html2canvas](https://github.com/niklasvh/html2canvas) 1.4.1（MIT），生成结算长图 |

## 本地开发与部署

```bash
wrangler dev --port 8811     # 本地运行，打开 http://localhost:8811
wrangler deploy              # 部署
```

## 测试

需要本机 Chrome 和 `npm i playwright-core`。

```bash
node tests/test_logic.mjs                                                # 算分（规则书示例）、房间规则
node tests/test_room.mjs    http://localhost:8811/ ./shots                # 两台手机完整对局、平局加赛、改分、撤销、存档、长图、评价（拦截）、冤家路窄残酷模式
node tests/test_teach.mjs   http://localhost:8811/ ./shots                # 讲规则页两个版本：讲稿要素、每个术语、「问」带版本、注意事项、卡牌图、375px（模拟回答，也可对线上跑）
node tests/test_chat.mjs    http://localhost:8811/ ./shots --no-key       # 规则助手界面（未配置密钥时）
node tests/test_chat.mjs    http://localhost:8812/ ./shots --mock-upstream # 备用模型切换（wrangler dev 加 --var DEEPSEEK_API_KEY:fake --var DEEPSEEK_BASE:http://127.0.0.1:8790 --var CHAT_CF_MODEL:@cf/none/missing）
node tests/test_chat.mjs    http://localhost:8812/ ./shots --mock-web      # 联网查找（同上；和上一条隔 1 分钟跑）
node tests/test_chat.mjs    https://flip7.leisurecat.cloud/ ./shots --live # 规则助手线上实问一次（需已设密钥）
```

`test_room.mjs` 会打完整局，在往期对局里留下记录，只对本地 `wrangler dev` 跑。

## 声明

- 本项目是非官方的玩家工具，不提供游戏本体，线下对局仍需实体卡牌。
- 规则依据 The Op 官方规则书和官方 FAQ；常见问题由本站整理，不是官方 FAQ。
- 游戏名称、规则和卡牌美术的权利归 USAopoly（The Op）所有，中文版由艾赐魔袋（Asmodee）发行。
- 代码以 [MIT](LICENSE) 许可开源。
