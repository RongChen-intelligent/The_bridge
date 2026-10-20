# 更新现有 THE BRIDGE

环境：`idhssses-d7gtdzl4f86a805c9`。正式静态应用为 `idhs`，目录 `/idhs/`；云函数为 `bridge-api`。沿用现有网关域名、数据库和全部环境变量。

1. 在现有 `bridge-api` 云函数中上传 `02-THE-BRIDGE-云函数-1.5.0.zip`，保存部署。包根目录直接包含 index.js 等文件；入口仍为 `index.main`。保留现有环境变量、网关和执行时间，不创建新函数、不重置密码。
   部署后先打开正式 `/bridge-api?route=health`，确认 `release: "1.5.0"` 和 `api_version: 5`。如果控制台函数测试已是新版而网址仍旧，检查 HTTP 路径关联的函数版本；详见 `docs/letter-fix.md`。
2. 解压 `01-THE-BRIDGE-前端-1.5.0.zip`。将 `index.html`、`thebridge.idhs.html`、`bridge-config.js` 和完整 `assets/` 文件夹覆盖上传到静态托管文件管理的 `idhs/`。不要传到静态根目录，也不要传到 `idhs1/`。
3. 如果选择平台 ZIP 部署方式，上传前端 ZIP，并确认自定义部署命令目标是：

```sh
tcb hosting deploy ./ /idhs -e idhssses-d7gtdzl4f86a805c9
```

4. 用原正式网址打开页面并强制刷新。再分别查看学生首页、通知、信箱和投票，以及工作人员三模块。此次先更后端、再更前端，避免新界面调用旧接口。

本次无需 SQL 文件、无需初始化数据库、无需改管理员密码。原账号与查询码继续使用。字体在 assets/ 中，不依赖 Google 在线字体服务。

日常通知、来信回复和投票直接在工作人员页面修改，无需重新上传代码。修改首页文字、布局或网站程序时，重新构建并覆盖对应部署包。

仅前端回滚不会清空数据，但旧界面无法完整操作新增功能。不要使用旧后端处理新版多选投票；如需回滚后台，先停止新增投票并由维护者评估新记录兼容性。

1.5.0：工作人员可删除来信与投票；来信保留期从首次回信起 30 天，不随追加延长。需要启用 `docs/retention-trigger.json` 的定时触发器，详见 `docs/update-guide.md`。

当前1.5.0审核、每日清理与完整上线步骤见 `docs/release-1.5.0.md`；资源变化见 `docs/resource-optimization-1.5.0.md`。
