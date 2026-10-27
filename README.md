# 运输船 · 联机对战

浏览器中的运输船团队竞技游戏。玩家使用邮箱注册和登录，创建或加入房间，选择潜伏者或保卫者进行对战。项目自带 Node.js 网页和 WebSocket 服务，以及 SQLite 账号、战绩和军衔数据存储。

## 从这里开始

| 你想做什么 | 阅读 |
|---|---|
| 了解规则、操作、房间和排行榜 | [游戏玩法](docs/游戏玩法.md) |
| 在自己的 Linux 服务器上部署、配置邮箱与 HTTPS | [自行部署](docs/自行部署.md) |
| 了解军衔经验的计算和结算限制 | [军衔与经验系统设计](docs/军衔与经验系统设计.md) |
<img src="https://jiuwei-picture-bed.oss-cn-hangzhou.aliyuncs.com/image/2025/20261027215241234.png"/>
<img src="https://jiuwei-picture-bed.oss-cn-hangzhou.aliyuncs.com/image/2025/20261027215341373.png"/>

## 本机快速启动

需要 **Node.js 24 或更新版本**。在项目根目录执行：

```bash
cd server
npm ci
npm start
```

打开 [http://localhost:8787/transport-ship-mp.html](http://localhost:8787/transport-ship-mp.html)。macOS 也可双击 `启动联机.command`，Windows 可双击 `start-windows.bat`；这两个启动器在终端中运行，关闭窗口即停止服务。

游戏页面打开后需要先登录。**注册和找回密码依赖 SMTP 邮件服务**：本机体验前也要配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`。macOS 启动器和 `deploy/start.sh` 会读取 `deploy/config.env`；Windows 启动器和手动执行的 `npm start` 使用进程环境变量。配置步骤见[自行部署](docs/自行部署.md#配置邮箱注册与找回密码)。已有账号登录不需要重新发送邮件。

两名玩家分别登录后，一人创建房间，另一人加入。两个阵营各有至少一名真人玩家时，房主即可开始。单人在房间内即使配置了 bot，也无法开启联机对局。

## 当前能力与边界

- 房间可选 4v4、5v5、6v6、8v8，以及目标分数和补位 bot；支持邀请空闲玩家、跟随在线玩家入房、进行中选阵营加入。
- 真人射击、刀和手雷的伤害由服务端计算；客户端仍上报位置和视角。机器人由房主客户端模拟，因此当前实现不能完全防止作弊。军衔经验有额外的结算条件，含 bot 的比赛不发经验。
- 历史累计、月、周、日和实时排行榜统计服务端认可的真人战绩；个人信息展示军衔经验、累计战绩和对局时长。
- 房间、在线状态和正在进行的比赛只存在于单个服务进程的内存中。重启会清空这些状态；账号、历史战绩和已完成结算保存在 SQLite。当前不支持把多个服务实例直接放到负载均衡器后共享房间。

## 项目目录

```text
transport-ship/
├── index.html                  首页
├── transport-ship-mp.html      游戏页面
├── web/                        联机页面、同步逻辑与测试台
├── server/                     HTTP、WebSocket、账号和战绩服务
├── deploy/                     Linux 安装、启动、停止与配置示例
├── docs/                       玩法、部署和军衔说明
├── 启动联机.command             macOS 本机启动器
└── start-windows.bat           Windows 本机启动器
```

开发调试可访问 `/web/testbed.html`，健康检查可访问 `/health`。服务默认监听 `0.0.0.0:8787`，正式对外提供邮箱登录时请按[自行部署](docs/自行部署.md)配置 HTTPS。运行数据默认写入 `.runtime/`，其中的数据库和邮件配置应由部署者妥善保管。
