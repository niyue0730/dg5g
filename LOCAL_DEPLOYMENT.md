# DGBook 本地部署说明

## 当前状态

- 本地目录：`/Users/ny/Documents/New project/dg5g-local`
- 本地入口：`http://127.0.0.1:3157`
- Node：`24.15.0`
- pnpm：`9.15.0`
- SQLite：schema 13，完整性校验通过
- 类型检查：通过
- 生产构建：通过
- 浏览器验收：学生首页、自学正文、教师工作台、教师授课页和投屏页均已打开
- 浏览器控制台：学生端和教师/投屏端均为 0 个错误

## 启动

在终端执行：

```bash
cd "/Users/ny/Documents/New project/dg5g-local"
./scripts/local-macos.sh dev
```

浏览器打开：

```text
http://127.0.0.1:3157
```

服务运行期间不要关闭该终端。按 `Control-C` 停止服务。

## 演示账号

| 角色 | 账号 | 密码 | 用途 |
| --- | --- | --- | --- |
| 教师 | `teacher01` | `123456` | 授课工作台、课堂控制、成果复核、投屏 |
| 学生一 | `student01` | `123456` | 从未开始状态走真实学习闭环 |
| 学生二 | `student02` | `123456` | 演示教师退回与学生修订 |
| 学生三 | `student03` | `123456` | 查看完整演示状态与项目成果包 |

## 常用命令

```bash
# 首次安装或重新安装
./scripts/local-macos.sh setup

# 重置三名演示学生和课堂状态
./scripts/local-macos.sh reset

# 检查数据库
./scripts/local-macos.sh verify

# 类型检查和生产构建
./scripts/local-macos.sh build

# 运行单元测试
./scripts/local-macos.sh test
```

## 本轮验证结果

仓库单元测试共 718 项，715 项通过。3 项失败均位于
`apps/web/src/platform/public-media.test.ts`，原因是 macOS 将同一临时目录分别表示为
`/var/...` 和 `/private/var/...`，测试使用字符串严格比较后产生差异。
该问题不影响本地页面、SQLite、媒体路由或构建，但后续应将测试断言统一为真实路径后再比较。

## 本地数据

默认数据库：

```text
apps/web/.data/dgbook-demo.sqlite
```

重置命令会清除三名演示学生本轮产生的学习、测试、成果和课堂参与数据。
需要保留过程数据时，先运行仓库 README 中的数据库备份命令。

## 后续独立优化建议

1. 先从 `apps/web/src/features/` 查找学生学习、教师授课、课堂跟随和课程能力图谱界面。
2. 状态、评分、成果和课堂同步逻辑优先检查 `apps/web/src/platform/`，不要在组件中写死演示数据。
3. 教材正文以 `content/5g/5g.docx` 为权威源；不要只修改 `textbook/5g/generated/` 生成物。
4. 每次改动后至少运行 `./scripts/local-macos.sh build`。
5. 涉及状态流转时，必须分别使用学生、教师和投屏三个浏览器上下文重新验收。
