# 贡献指南

感谢你对运输船项目的关注！

## 开发环境

需要 **Node.js 24 或更新版本**。

```bash
cd server
npm ci
```

## 本地运行

```bash
cd server
npm start
```

访问 [http://localhost:8787/transport-ship-mp.html](http://localhost:8787/transport-ship-mp.html)。

## 测试

```bash
cd server
npm run test:data      # 数据层回归测试
npm run check:game     # 构建产物一致性检查
```

## 修改客户端代码

修改 `src/client/` 或 `shared/maps/` 后需要重新构建：

```bash
cd server
npm run build:game
```

`npm start` 会自动执行构建。

## 提交代码

1. 确保测试通过：`npm run test:data`
2. 确保构建产物一致：`npm run check:game`
3. 用简洁的中文描述改动
4. 一个 PR 解决一个问题

## 代码风格

- 延续项目现有实现方式
- 不引入新依赖，除非有充分理由
- 遵循 [AGENTS.md](AGENTS.md) 中的开发约定
