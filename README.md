# WORK-Plat · 个人法务工作台

纯前端（vanilla JS）的单机版个人法务工作台：任务 / 日程 / 项目（诉讼·执行·破产等类别模板）/ 人员管理（对接人·经办法官）/ 智能汇报 / 提醒 / 数据导出。

- 数据默认存于浏览器 `localStorage`；本地运行时可镜像到 `D:\workbuddy\workplat数据存储` 并加密同步至私有云仓库（见 `server/sync.js`）。
- 响应式适配桌面 / 平板 / 手机。

## 本地运行

```bash
# 方式一：静态服务器（纯前端，数据在 localStorage）
python -m http.server 8123
# 浏览器打开 http://localhost:8123/

# 方式二：本地同步服务（含 D:\ 文件存储 + 云端加密同步）
node server/sync.js          # 默认端口 8200
# 浏览器打开 http://localhost:8200/
```

## 本地数据 + 加密云同步

`server/sync.js` 同时提供静态站点与同步接口：

- `POST /api/save` 接收前端 DB，写入 `D:\workbuddy\workplat数据存储\workplat.db.json`，并将加密副本推送至私有数据仓库；
- `GET  /api/load` 返回当前（云端优先）DB，供前端水合；
- 定时任务（`tasks/sync-task.xml` 导入 Windows 任务计划程序）周期性双向同步。

加密口令保存在本机 `.sync-config.json`（不进仓库）。首次使用请：

```bash
cp .sync-config.example.json .sync-config.json   # 填入你的加密口令与云端仓库
```

## 部署（GitHub Pages）

将本仓库推送到 GitHub 后，在仓库 **Settings → Pages** 选择 `main` 分支 `/root` 即可获得固定访问链接。
