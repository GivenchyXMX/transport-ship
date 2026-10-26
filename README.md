# 运输船 · 联机对战

浏览器版运输船团队竞技，提供邮箱注册、密码登录、邮箱找回密码、房间、阵营、5v5 状态同步、服务端血量裁决、联机排行榜和军衔系统。Node.js 进程同时提供网页、账号接口和 WebSocket；账号、历史战绩和军衔结算保存在 SQLite，房间与正在进行的对局保存在内存。

军衔、经验曲线和防刷结算的规则见 [军衔与经验系统设计](docs/军衔与经验系统设计.md)。军衔功能已接入，经验发放默认开启。

## 项目文件

```text
transport-ship/
├── index.html                 首页
├── transport-ship-mp.html     游戏页面
├── web/                       联机前端、房间 UI、测试台
├── server/                    Node.js HTTP / WebSocket 服务及 npm 锁文件
├── deploy/                    Linux 安装、后台启动、停止和状态脚本
├── 启动联机.command            macOS 本地前台启动器
└── start-windows.bat          Windows 本地前台启动器
```

## 本地运行

需要 Node.js 24 或更新版本。macOS 可双击 `启动联机.command`，Windows 可运行 `start-windows.bat`；两者都是前台启动，关闭终端即停止。也可手动运行：

```bash
cd server
npm ci
npm start
```

浏览器打开 `http://localhost:8787/transport-ship-mp.html`，页面加载后即显示登录界面。新玩家填写邮箱、游戏昵称和密码，输入邮件验证码完成注册；之后用邮箱和密码登录。忘记密码时可通过邮箱验证码设置新密码。配置 SMTP 的方法见下文。两名玩家分别登录，一人建房、一人入房；系统自动把新玩家排到人数较少的阵营。**两边各有至少一名真人玩家**后，房主可以开局。`http://localhost:8787/web/testbed.html` 可用于快速检查状态同步。

本地可以在同一浏览器中新开两个标签，分别登录不同账号对战。每个标签在 `sessionStorage` 中保存自己的随机标签 ID；服务器按该 ID 读取对应的 HttpOnly 登录 Cookie，刷新页面和断线重连仍使用当前标签的账号。复制已有标签可能复制其 `sessionStorage`，建议用浏览器的“新建标签页”打开第二个账号。进入对局和复活后的前 3 秒有保护，此时命中不会造成伤害。

主菜单显示当前在线玩家的昵称及“空闲 / 在房间”状态。登录后的联机大厅和房间页侧栏会显示在线玩家所在的房间名；点击“跟随”会尝试加入对应房间。在房间里可以对空闲玩家点击“邀请”，对方页面右上角会显示邀请，可接受并入房或拒绝；邀请 30 秒后失效，接受时仍须满足房间有空位等入房条件。正在战斗且有空位的房间允许中途加入；新玩家先进入房间，选择有空位的阵营，再点击“加入战斗”，随后在本方出生点出生，并接收当前比分、剩余时间和其他玩家状态。等待中的房间仍会在入房时自动分配到人数较少的阵营。已满或即将结束的对局无法加入。返回主菜单时仍保持联机连接，退出账号或关闭页面后离线。

## Linux 服务器部署

适用 Linux x86_64 / aarch64。准备好项目文件，以及能访问 npm 和 Node.js 发布站点的网络。安装脚本优先使用现有 Node.js 24+；若缺少，则从 [Node.js 官方发布目录](https://nodejs.org/dist/latest-v24.x/)下载当前 24 LTS 发布包，验证 SHA-256 后安装在项目的 `.runtime/node`，不覆盖系统 Node.js。CentOS 7 等 glibc 2.17 的 x86_64 主机会改用 [社区维护的兼容构建](https://unofficial-builds.nodejs.org/)；该构建属于实验项目。仅在缺少 curl、tar 或校验工具时，脚本会通过 apt、dnf 或 yum 安装这些基础工具，可能需要 sudo。

在**项目根目录**执行：

```bash
./deploy/install.sh
./deploy/start.sh
./deploy/status.sh
```

安装脚本会用 `npm ci` 安装锁定版本的依赖，并首次生成 `deploy/config.env`。默认监听 `0.0.0.0:8787`；要更改端口或只允许本机反向代理访问，请修改配置：

```bash
PORT="8787"
HOST="127.0.0.1"   # 邮箱登录部署时由同机 HTTPS 反向代理接入
```

### 邮箱注册与找回密码配置

在 `deploy/config.env` 中填写邮件服务商提供的 SMTP 参数，然后重启服务：

```bash
PUBLIC_ORIGIN="https://game.example.com"   # 与玩家打开游戏的 HTTPS 地址完全一致，不带结尾 /
SMTP_HOST="smtp.example.com"
SMTP_PORT="465"                       # 465 为 SSL；587 为 STARTTLS
SMTP_USER="sender@example.com"
SMTP_PASS="邮件服务商提供的 SMTP 授权码"
SMTP_FROM="sender@example.com"
```

运行 `chmod 600 deploy/config.env` 保护邮件授权码。未配置 SMTP 时，注册和找回密码无法发送验证码；请在启用新版本前完成配置。验证码 10 分钟有效，重复发送至少间隔 60 秒；密码用带随机盐的 scrypt 哈希保存；登录会话保留 30 天。重置密码会使此前的登录会话失效。账号、会话、历史战绩和军衔结算保存在 `.runtime/accounts.sqlite`，升级或重启时不要删除该文件；备份时同时包含 SQLite 的 `-wal` 文件，或先停止服务再备份。现有仅使用临时昵称的玩家需要注册账号。

邮箱密码、验证码和登录 Cookie 必须通过 HTTPS 传输。反向代理与 Node.js 同机时，把 `HOST` 设为 `127.0.0.1`，用 `PUBLIC_ORIGIN` 指定对外地址。浏览器会连接同源的 `/api/auth/*` 和 `/ws`，不再手动填写 WebSocket 地址。单机本地调试可以使用 `http://localhost:8787`。

日常操作：

```bash
./deploy/stop.sh                 # 停止脚本启动的服务
./deploy/start.sh                # 再次后台启动
./deploy/status.sh               # 查看进程和 /health
tail -f .runtime/server.log      # 查看日志
```

脚本会记录 PID，只停止本项目由它启动的进程；`.runtime/` 保存 PID、日志和可选的 Node.js 运行时。代码更新后执行 `stop.sh`、`install.sh`、`start.sh`。这个后台启动方式**不会在服务器重启后自动恢复**；需要开机自启和故障自动重启时，建议另行接入 systemd 等服务管理器，避免同时用两种方式启动同一端口。

### 对外访问

- **域名与 HTTPS**：将 `HOST=127.0.0.1`，在同机配置支持 WebSocket 的反向代理。以 [Caddy](https://caddyserver.com/docs/quick-starts/https) 为例，域名解析到服务器、80/443 可从公网访问时，可使用下列 Caddyfile。用户访问 `https://game.example.com/`，浏览器会使用 `wss://game.example.com/ws`，无需对公网开放 8787。

  ```caddyfile
  game.example.com {
      reverse_proxy 127.0.0.1:8787
  }
  ```
- **健康检查**：`curl http://127.0.0.1:8787/health` 返回 `ok: true`；从外部无法访问时，检查监听地址、云安全组、防火墙、反向代理和浏览器联机页显示的 WebSocket 地址。

房间、在线玩家和实时榜战绩只保存在当前服务进程内存中。停止、重启或崩溃后，现有房间和对局会清空，玩家需要重新建房；账号、会话、历史榜战绩和已完成的军衔结算继续保存在 SQLite。未结束的比赛重启后会标记中断，不补发经验；已持久化结束但尚未结算的比赛会在启动时重试。当前版本没有多进程共享房间状态，不要在负载均衡器后直接启动多个服务实例。静态服务只开放游戏网页和所需脚本，不提供 `server/`、`.runtime/` 或部署配置文件的下载。

### 军衔与经验

登录后在联机页面右上角点“个人信息”，可查看当前账号的昵称、邮箱、军衔、升级进度、累计真人击杀与死亡、KDA、累计对局时长及最近结算；赛后显示本局 XP 明细和未计经验原因。当前没有助攻记录，因此 KDA 暂按击杀数除以 `max(死亡数, 1)` 计算。对局时长取已结束比赛中服务端累计的实际参赛秒数；服务重启前未结束的比赛不计入。服务端生成比赛 ID，按服务器确认的真人击杀、首次出生及参赛时长结算；每个账号每局只记账一次。历史榜中的旧击杀不追溯经验。只读接口为 `GET /api/rank/me` 和 `GET /api/rank/settlements?limit=20`，均要求当前标签页已登录，邮箱只返回给本人。

默认 `RANK_XP_ENABLED=1`，符合资格的新比赛正常发放 XP。如需暂停发放，在 `deploy/config.env` 设置 `RANK_XP_ENABLED="0"` 并重启服务；开关只影响**之后新开始**的比赛，旧比赛不会补发或扣回。建议双人实战核对射击、遮挡、刀、手雷、复活和中途加入的判定。服务器仍接收客户端位置和视角输入，不能完全阻止自动瞄准或多账号串通刷分；当前没有挂机行为识别，在线时长规则只按首次出生至离房或结束计算。

### 联机排行榜

登录后，在联机大厅或房间页点“排行榜”。可切换最高击杀、最多爆头、击杀/死亡比和最多死亡四项，以及历史累计、月榜、周榜、日榜、实时榜五个范围。日榜从北京时间当天 00:00 开始，周榜从本周一 00:00 开始，月榜从本月 1 日 00:00 开始；历史累计包含全部已记录的战绩。实时榜只统计当前正在进行的对局，并每 5 秒刷新。

榜单按账号统计服务端裁决的**真人对真人**击杀和死亡；爆头数指致命一击为头部的次数，机器人不计入。K/D 为击杀数除以死亡数，死亡为 0 时按 1 计算。每项显示前 50 名。历史战绩从本功能上线后开始累计，旧对局无法补录。接口为登录后访问的 `GET /api/leaderboard?period=all|month|week|day|live`。

---

## 二、整体架构

```
┌──────────┐        房间 / 名单 / 转发 / 裁决        ┌──────────┐
│  客户端 A │ ◄──────────── WebSocket ──────────────► │  客户端 B │
│  (权威=自己)│                    ▲                   │  (权威=自己)│
└──────────┘                    │                   └──────────┘
                          ┌─────┴─────┐
                          │  服务器     │
                          │ 血量/死亡/比分│
                          └───────────┘
```

### 关键决策：谁说了算

| 数据 | 权威方 | 原因 |
|---|---|---|
| 位置 / 朝向 / 蹲伏 / 换弹动作 | **各自的客户端** | 谁操作谁说了算，本地手感不"黏" |
| 命中判定（射线检测） | **开枪的那一方** | 他屏幕上看到的就是他打到的，不用预判别人位置 |
| 血量 / 死亡 / 比分 | **服务器** | 避免两端各算一套导致分叉，也是唯一的反作弊点 |
| bot 的一切 | **房主客户端** | 服务器没有地图和 AI，跑不了 bot |

> 这就是早期 FPS（含 CF 早期）用的 **client-authoritative hit detection**。
> 优点：手感好、实现简单。代价：理论上可以被改包。
> 服务器已经做了基础校验（阵营 / 存活 / 保护期 / 伤害区间 / 每秒命中次数上限）。

---

## 三、协议

所有消息都是 JSON，字段尽量短（带宽敏感）。

### 账号与大厅

账号接口：`POST /api/auth/register`（邮箱、昵称、密码，发送注册验证码）、`POST /api/auth/verify-register`（邮箱、验证码，完成注册）、`POST /api/auth/login`（邮箱、密码）、`POST /api/auth/forgot-password`（发送找回验证码）、`POST /api/auth/reset-password`（验证码、新密码）、`GET /api/auth/me`、`POST /api/auth/logout`。客户端在 HTTP 请求的 `X-Ship-Tab` 头和 `/ws?tab=...` 中提交标签 ID；服务器只读取该标签对应的同源 HttpOnly Cookie。标签 ID 不是登录令牌，未登录的 WebSocket 升级返回 401。昵称来自账号资料，客户端不能在 `hello` 消息中更改。

| 方向 | 消息 |
|---|---|
| C→S | `hello`（可选，服务端回显账号昵称） |
| C→S | `list` |
| C→S | `create{name,size,goal,bots,team}` |
| C→S | `join{roomId}` |
| C→S | `team{team:"BL"\|"GR"\|null}` |
| C→S | `ready{v}` |
| C→S | `start`（仅房主） |
| C→S | `leave` |
| C→S | `invite{to}`、`invite_reply{inviteId,accept}` |
| C→S | `join_battle`（已开战房间选好阵营后进入战斗） |
| S→C | `welcome{netId}`, `hello{netId,name}`, `list{rooms[]}`, `room{room}`, `joined{roomId}`, `err{msg}` |
| S→C | `invite{inviteId,fromName,roomId,roomName,expiresAt}`、`invite_cancel{inviteId}`、`invite_status{status,name}` |

`size` = 每队人数（5 → 5v5），`team` 为 `null` 表示"退出阵营、回到待选"。

### 对局

| 方向 | 消息 | 说明 |
|---|---|---|
| C→S | `st{p:[x,y,z],y,pi,c,fwd,sp,vy,g,w,r,f}` | 20Hz 上报自己的状态；`f` 是累计开火序号 |
| C→S | `shot{dir:[x,y,z],w,seq}` | 上报开枪方向；服务端计算真人命中部位与伤害 |
| C→S | `melee{heavy}`、`grenade` | 刀击和投掷动作；服务端判定真人伤害 |
| C→S | `hit{v,d,p,w}` | 仅对房主模拟的 bot 保留，不会改变真人血量或历史战绩 |
| C→S | `respawned{p,y,w}` | 本地完成出生或复活后上报；服务端检查是否为合法出生点 |
| C→S | `bots{a:[...]}` | 房主广播 bot 快照 |
| S→C | `st{ts,a:[{i,...,hp,al}]}` | 20Hz 广播所有人状态（血量/存活由服务器补） |
| S→C | `hp{i,hp,armor,k,w,p}` | 血量变化 |
| S→C | `kill{v,k,w,hs,score}` | 击杀 |
| S→C | `spawn{i,team,p,y,w}` | 复活 |
| S→C | `correct{p}` | 服务端纠正不合法位置 |
| S→C | `member_join{player}` / `member_leave{netId}` | 战斗中加入或离开，客户端动态增删角色 |
| S→C | `end{score,winner,reason}` | 结束 |

**开局** `S→C start{selfId,host,team,size,goal,duration,score,players[],bots[]}`：
`players[]` 里**只有别人**，自己由本地 `game.player` 表示 —— 这样本地操作零延迟。
中途加入者先在房间选阵营，发送 `join_battle` 后才收到 `start`；该消息还包含 `late:true`、`serverTime`、`endsAt`、真人状态 `states[]` 和机器人状态 `botStates[]`。新玩家完成本地加载后发送 `respawned`，服务器才将其设为已出生并广播给其他玩家。

真人伤害由服务器按运输船地图的简化碰撞体、武器参数和位置历史判定。客户端仍控制自己的输入和视角；目前无法单靠协议阻止自动瞄准或多人串通刷分。bot 的模拟仍在房主页面，军衔经验设计中含 bot 的对局不计经验。

---

## 四、客户端怎么接进原版游戏（核心）

原版是压缩过的 IIFE，但最后一行有 `window.__game = this`，一切从它入手。

### 4.1 反查内部类

类名被压成 `_r / uc / Fa / hc / _s`，但**引用拿得到**：

```js
const ActorBase = Object.getPrototypeOf(Object.getPrototypeOf(game.player)).constructor; // _r 基类
const Soldier   = game.player.soldier.constructor;                          // hc 士兵模型
const Bot       = game.actors.find(a => !a.isPlayer).constructor;           // Fa bot
const Weapon    = game.player.inv[0].constructor;                           // _s 武器
```

### 4.2 Ghost：远端玩家的替身

```js
class Ghost extends ActorBase {
  update(dt) {
    this.respawnT = 1e9;   // 生死听服务器的，禁止本地自动复活
    // 位置/朝向指数平滑，避免 20Hz 数据抖动
  }
}
```

因为 Ghost **真的被 push 进 `game.actors`**，所以原版这些功能全部自动生效，一行都不用改：
- 子弹命中检测（用 `soldier.hitTest`）
- 雷达红点
- 记分牌 / 名字条
- 死亡布娃娃

### 4.3 四个钩子（都在 `web/mp.js`）

| 钩子 | 作用 |
|---|---|
| `game.startMatch` | 原版生成完 player + bot 后，删掉 bot，按房间名单建 Ghost；房主额外保留真实 bot |
| `game.damage` | 分流：我打远端 → 上报；远端打我 → 丢掉（等他的上报）；打到本地 bot → 原版裁决 |
| `game.spawnActor` | 我复活了 → 上报服务器 → 服务器广播给别人 |
| `game.fireWeapon` | 累计开火序号，远端据此播放枪口火焰 / 枪声 / 弹道 |

### 4.4 房间配置 / 阵营界面

`web/ui.js` 提供完整的大厅：

- 打开游戏页：邮箱密码登录、注册和忘记密码入口
- 大厅：房间列表（刷新 / 创建：人数 4v4 / **5v5** / 6v6 / 8v8、目标击杀、是否补 bot）
- 房间页：**进入时自动分配到人数较少的阵营**；两个阵营卡片每队 N 个槽位，点空位可换队，已入阵营可「退出阵营」；两边都至少有一名真人玩家时，房主才能开始

---

## 五、已知边界 & 下一步

**当前没做的**
- **手雷不同步**：远端玩家扔的手雷你看不见（需要新增 `nade` 事件 + 弹道状态同步）
- **近战刀**不同步：远端挥刀没有表现
- **延迟补偿（lag compensation）**：现在射手打到的是"插值后的位置"，比真实位置晚约 50~100ms。高延迟下需要"回溯"
- **服务器不做视线校验**：现在只校验阵营/存活/保护期/频率，理论上可穿墙报伤害

**建议的下一步（按性价比排序）**

1. **延迟补偿**：每个客户端保存远端状态的历史环形缓冲（带时间戳），开火时把 Ghost 临时回溯到 `now - (rtt/2 + 插值缓冲)` 再做射线检测。这是联机 FPS 手感的分水岭。
2. **手雷同步**：`{t:'nade', i, p, v, fuse}` + 本地生成 mesh，落地爆炸统一由服务器广播 `explode`。
3. **服务器视线校验**：服务器持有地图 AABB 列表（从客户端上报一次），收到 `hit` 时做一次射线检测。
4. **重连 / 断线恢复**：现在掉线即退出房间，可以做 token 重连。
5. **房间观战**：当前中途加入会直接分队并出生；观战模式可单独增加。

---

## 六、调参

| 位置 | 参数 | 当前值 |
|---|---|---|
| `server/server.js` | `TICK_MS` | 50（20Hz 广播） |
| `server/server.js` | `RESPAWN_MS` | 4000（**必须**和游戏 `kill()` 里的 `respawnT=4` 一致） |
| `server/server.js` | `PROTECT_MS` | 3000（**必须**和游戏 `spawn()` 里的 `protectT=3` 一致） |
| `server/server.js` | `MAX_HPS` | 15（单人每秒最多上报的命中次数） |
| `web/mp.js` | `setInterval(sendLoop, 50)` | 20Hz 上报 |
| `web/mp.js` | `Math.exp(-dt * 14)` | 插值刚度，调大更跟手但更容易抖 |

> ⚠️ `RESPAWN_MS` / `PROTECT_MS` 与原版不一致会导致"服务器说你还活着但你本地已经倒了"之类的分叉，改游戏里那两个常量时记得同步改服务器。
