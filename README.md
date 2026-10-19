# THE BRIDGE · 2026-10-18

SSES 学生会校园平台。React 前端，CloudBase 云函数 HTTP API，PostgreSQL JSONB 记录存储。本次版本在已成功部署的环境上更新界面与业务功能。

当前版本 1.4.0：附件采用 512 KB 二进制分段上传，单文件 10 MB、合计 40 MB；正文对齐与字号即时生效，保留来信详情白屏保护。正式健康接口应返回 `release: "1.4.0"`、`api_version: 4`。原因、复现与发布诊断见 `docs/letter-fix.md`。

## 正式入口

- 学生端：https://idhssses-d7gtdzl4f86a805c9-1508185821.ap-shanghai.app.tcloudbase.com/idhs/
- 工作人员：https://idhssses-d7gtdzl4f86a805c9-1508185821.ap-shanghai.app.tcloudbase.com/idhs/#/staff
- API：同源 `/bridge-api`，云函数名 `bridge-api`。

## 本地维护

在已安装依赖的项目中：

```sh
node scripts/build.mjs
node scripts/test-http.cjs
node tests/local-server.cjs
```

新机器使用 Node.js 22+，先运行 `npm ci`。构建输出为 `dist/frontend/`。本地预览默认 `http://127.0.0.1:4178/idhs/`，使用独立 PGlite 测试库。默认首次登录密码仅用于本地 QA，写在测试服务器脚本中，不能作为正式密码。`BRIDGE_TEST_DATA_DIR` 可以指定测试数据目录。

```sh
python scripts/package-release.py --out <交付目录>
```

打包采用明确目录白名单，并递归保留全部 React 子页面、字体与许可证。排除 private、环境文件、node_modules、测试数据库及历史包；检查完整密码哈希、JWT、私钥标记。生产后端没有 npm 依赖。

## 功能与约定

- THE SIGNAL：学生只读；工作人员新建、改写、删除、保存草稿、定时发布；安全 Markdown 排版、段落对齐与字号、图片/PDF 附件。
- THE VOICE：按类别来信；一个查询码对应完整对话；学生追加来信、工作人员独立多次回信；追加请求有幂等标识，旧信件和旧回复在读取时兼容。工作人员列表按类别、状态及时间/来信次数筛选，完整历史按需读取。
- THE COMMON GROUND：2–8 个图文选项；最多选择数量；服务器时间倒计时；截止和提前结束；结果按票数排名，并列保留同名次；可设置票数、占比的展示。进行中 API 不向学生返回票数、总人数或占比。多选占比以参与人数为分母，合计可能超过 100%。
- 浏览器凭证限制每浏览器每活动一次；不保证跨设备、清除 Cookie 后仍为一人一次。此平台用于匿名校园意见参考。
- 投票题目/选项/截止时间可在尚无人投票时编辑；有人投票后锁定内容，仍可提前结束与调整展示设置。
- 文件支持 PNG、JPEG、WebP、PDF；每个 ≤10 MB，每条内容合计 ≤40 MB。通知最多 8 个附件；投票每个选项 1 张图片。正文 6000 字、来信/回信每次 2000 字。没有人为设置来信或回信的次数上限。
- 所有更新沿用现有数据库记录表，不需要执行新 SQL。查询码、账号、原信件和投票不会因更新包主动清空。

## 代码位置

`frontend/app/page.tsx` 首页；`frontend/styles.css` 统一视觉；`frontend/app/components/campus-pages.tsx` 通知和投票；`frontend/app/voice/page.tsx` 学生信箱；`frontend/app/staff/` 工作人员页面；`backend/core.js` 权限与业务；`backend/store.js` 分页查询；`backend/http-store.js` 原有 SQL HTTP 原子提交。

`database/` 仅供维护和全新环境参考。已上线环境不要重跑初始化、事务迁移或管理员配置。部署步骤见 HTTP-DEPLOY.md。

## 验证边界

本次完成本地业务与数据库回归、真实浏览器流程以及多尺寸截图检查。没有上传或改写正式网站、生产数据库或账号。CloudBase 上的实际上传和最终业务验收由维护者按部署说明完成。

字体本地打包：Cormorant Garamond（Christian Thalmann / Cormorant Project Authors）与 Manrope（Mikhail Sharanda / Manrope Project Authors），均为 SIL OFL；许可证在 `frontend/assets/`。参考图由用户提供，存于 `docs/homepage-reference.png`。没有使用外部校园照片、视频或编造活动统计。

1.4.0：工作人员可删除来信与投票；来信保留期从首次回信起 30 天，不随追加延长。需要启用 `docs/retention-trigger.json` 的定时触发器，详见 `docs/update-guide.md`。
