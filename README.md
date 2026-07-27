# DGBook 5G 数字教材

DGBook 是一套面向 5G 网络优化职业教学的数字教材样张。当前产品只证明一条完整主线：一名教师、三名学生，在 P1“5G 网络信息采集”项目中完成 P01 室内、P02 室外、P03 投诉三个任务，并让自学、授课、课堂跟随、投屏、正式测试、专业成果和课程能力图谱使用同一套事实数据。

线上样张：[http://8.153.206.97/](http://8.153.206.97/)

## 1. 五分钟启动

技术栈：TypeScript + React + Next.js。环境基线：Node `24.15.0`、pnpm `9.15.0`、Python `3.12`（仅导入教材时需要）。

```powershell
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @dgbook/web db:reset:demo
pnpm dev
```

浏览器打开 `http://127.0.0.1:3157/`。

演示账号：

| 角色 | 账号 | 默认密码 | 用途 |
| --- | --- | --- | --- |
| 教师 | `teacher01` | `123456` | 授课工作台、课堂控制、成果复核、投屏 |
| 学生一 | `student01` | `123456` | 从未开始状态走真实学习闭环 |
| 学生二 | `student02` | `123456` | 演示教师退回与学生修订 |
| 学生三 | `student03` | `123456` | 查看完整演示状态与项目成果包 |

共享或生产环境必须通过 `DGBOOK_DEMO_PASSWORD` 覆盖默认密码，不要把密码、API Key 或 SSH 凭据写入仓库。

## 2. 产品验收主线

```text
角色登录
  → 学生学习首页 / 教师授课工作台
  → P1 项目（P01 → P02 → P03）
  → 能力节点自学或课堂跟随
  → 微练习
  → 独立正式测试
  → N04 任务成果填写与提交
  → 教师退回 / 学生修订 / 教师确认
  → P1 项目成果包
  → 课程能力图谱回流
```

必须持续满足：

- 学生首页在 30 秒内回答“学什么、为什么学、下一步做什么、做到什么算完成”。
- 教师从工作台两次点击内进入 P1T1-N02 授课页。
- P01、P02、P03 共 12 个能力节点均可按前置关系进入。
- 自主学习游标不被教师翻页覆盖；课堂跟随学生与投屏使用课堂游标。
- 打开页面、完成微练习、正式测试达标、成果提交、教师确认和能力达成是不同事件。
- 教师、学生、投屏、成果包和能力图谱从 SQLite 读取同一事实，不写死人数、分数或状态。
- 样张固定为一名教师和三名学生；不要为演示伪造 24 人在线数据。

## 3. 工程结构

```text
apps/web/                         Next.js 唯一产品运行时
  src/app/                        路由、鉴权、服务端数据装配
  src/features/learning/          学生首页、P1、自学、测试和成果
  src/features/classroom/         教师、课堂跟随和投屏
  src/features/capability-map/    课程能力图谱
  src/platform/                   SQLite、状态机、快照和媒体适配
  database/                       迁移、基础种子和三学生演示种子
  public/media/                   已验证且可部署的运行媒体闭包
packages/                         动画、组件、EduGame、共享类型和生成能力
content/5g/5g.docx                权威教材源文件
config/textbooks/5g/              5G 导入规则、术语和清单
textbook/5g/                      导入生成的教材结构与 P1 运行内容
scripts/                          导入、门禁、浏览器审计、课堂助手和部署
schemas/ + templates/             教材 DSL 与资源格式
tools/manim-scenes/               可重建的专业动画场景源
docs/                             当前产品经验与设计文档
```

边界规则：

1. `content/5g/5g.docx` 是教材正文的权威源；不要直接修补生成文件来掩盖导入问题。
2. `textbook/5g/generated/` 是应用读取的 P1 内容；修改源文件或导入器后重新生成。
3. `apps/web/public/media/` 是唯一运行媒体闭包；未经过清单和 SHA 校验的素材不得直接挂接。
4. 作者媒体可在本地被忽略的 `site/public/media/` 中准备，但该目录不属于交付源码，运行时不能读取它。
5. 纯动画只表达知识，不内置播放器、讲师或 TTS 配置；播放控制属于应用层。

## 4. SQLite 与演示数据

默认数据库为 `apps/web/.data/dgbook-demo.sqlite`，可用 `DGBOOK_SQLITE_PATH` 指向其他文件。数据库启用 WAL、外键和忙等待；不要只删除 `-wal` 或 `-shm` 文件，也不要用 localStorage 或浏览器模拟数据覆盖服务端事实。

```powershell
pnpm --filter @dgbook/web db:migrate
pnpm --filter @dgbook/web db:seed:base
pnpm --filter @dgbook/web db:seed:demo
pnpm --filter @dgbook/web db:reset:demo
pnpm --filter @dgbook/web db:verify
pnpm --filter @dgbook/web db:backup .\backup\dgbook.sqlite
```

`db:reset:demo` 会清除三名演示学生本轮产生的学习、测试、成果和课堂参与数据。需要保留真实演示过程时先备份数据库。

## 5. 课堂助手

普通本地演示可直接启动 Web 应用。需要严格验证教师翻页、学生跟随和投屏同步时，另开终端启动课堂助手：

```powershell
$env:DGBOOK_DEMO_PASSWORD = '123456'
$env:DGBOOK_HELPER_TOKEN = '<至少 32 位随机字符串>'
$env:DGBOOK_STRICT_CLASSROOM_HELPER = '1'
pnpm classroom-helper:start -- --session demo-class --students stu-01,stu-02,stu-03 --base-url http://127.0.0.1:3157 --headless
```

课堂助手默认健康端口为 `127.0.0.1:17352`。严格模式下，教师操作只有收到真实 `applied` 回执才显示成功；生产环境未配置 `DGBOOK_HELPER_TOKEN` 时，助手接口应保持禁用。

常用课堂环境变量：

| 变量 | 说明 |
| --- | --- |
| `DGBOOK_SQLITE_PATH` | SQLite 文件路径 |
| `DGBOOK_DEMO_PASSWORD` | 演示账号密码 |
| `DGBOOK_HELPER_TOKEN` | Web 与课堂助手之间的共享密钥 |
| `DGBOOK_STRICT_CLASSROOM_HELPER=1` | 禁用演示回退，要求真实助手在线 |
| `DGBOOK_TRUST_PROXY=1` | 允许受信任反向代理头 |
| `DGBOOK_DEMO_PUBLIC_ORIGIN` | 公共介绍页入口，如 `https://demo.example.com` |
| `DGBOOK_DEMO_TEACHER_ORIGIN` | 教师端和演示控制台入口，如 `https://teacher.demo.example.com` |
| `DGBOOK_DEMO_STUDENT_ORIGIN` | 学生端独立入口，如 `https://student.demo.example.com`；公网演示必填 |
| `DGBOOK_DEMO_PROJECTOR_ORIGIN` | 投屏端入口；可与教师端相同，独立部署时如 `https://screen.demo.example.com` |
| `DGBOOK_DEMO_AUTO_LOGIN=1` | 公网启用私有演示启动链接；本地回环地址无需配置 |
| `DGBOOK_DEMO_PRESENTER_KEY` | 公网演示启动密钥，至少32位随机字符串，不得写入仓库或普通页面 |

公网多角色演示必须让教师端与学生端使用不同主机名，并将所有入口反向代理到同一应用和同一数据源。教师使用私有链接进入控制台，学生窗口由控制台自动建立会话；两端均不显示登录页。完整配置及上线门禁见 [`docs/DEMO_MULTI_ROLE_DEPLOYMENT.md`](docs/DEMO_MULTI_ROLE_DEPLOYMENT.md)。

## 6. 教材内容与媒体

教材内容变更顺序：

1. 修改 `content/5g/5g.docx`，或先修正 `scripts/import-5g-docx.py`、`scripts/import_5g/` 与 `config/textbooks/5g/`。
2. 运行导入。
3. 审核 `textbook/5g/` 的差异与导入报告。
4. 运行内容、语义、媒体和产品门禁。

```powershell
uv run --python 3.12 scripts/import-5g-docx.py
pnpm audit:semantic
pnpm audit:content
pnpm validate:media-assets
```

需要重建 Manim 资源时先运行 `pnpm media:setup:manim`；可用 `DGBOOK_MANIM_PYTHON` 指定 Python。`audit:content` 只把当前开放的 P01、P02、P03 作为必备 Manim 范围，并从 `apps/web/public/media/` 校验清单、文件和教材挂接；未开放项目不应伪装成已交付资源。

## 7. 开发与质量门禁

日常改动至少运行：

```powershell
pnpm web:test:unit
pnpm typecheck
pnpm web:check-structure
pnpm build
```

完整产品门禁：

```powershell
pnpm qa:web
pnpm qa:gates
```

`qa:gates` 会创建隔离数据库和可再生的 `output/` 检查结果；发布打包命令才会创建 `artifacts/`。不要让测试直接修改含真实教学数据的 SQLite。浏览器相关改动还应运行对应审计，例如：

```powershell
pnpm audit:self-study-closure
pnpm audit:teaching-package-navigation
pnpm audit:class-session-cross-context
pnpm audit:p1-three-terminal-consistency
```

代码约定：TypeScript、ESM、React 函数组件、2 空格缩进；组件文件用 `PascalCase`，变量与工具函数用 `camelCase`。路由文件只做鉴权和数据装配，产品逻辑放在 `src/features/` 或 `src/platform/`。不要手改构建产物。

## 8. 发布

推荐由环境变量或密钥管理服务提供部署信息，仓库中不保存服务器密码：

```powershell
$env:DGBOOK_WEB_DEPLOY_HOST = '<服务器>'
$env:DGBOOK_WEB_DEPLOY_USER = '<用户>'
$env:DGBOOK_WEB_DEPLOY_SSH_KEY = '<私钥路径>'
$env:DGBOOK_HELPER_TOKEN = '<生产随机密钥>'
$env:DGBOOK_WEB_DEPLOY_TRANSPORT = 'ssh'
pnpm deploy:web:source:ready
```

- `pnpm deploy:web:source`：生成带 SHA-256 的源码发布包。
- `pnpm deploy:web:source:ssh`：通过 SSH 传输已生成的发布包。
- `pnpm deploy:web:source:paramiko`：使用 Paramiko 传输；密码也只能来自环境变量。
- `pnpm deploy:web:source:ready`：执行类型检查、构建、打包、部署、远端协议和页面审计。

Windows 开发机优先使用源码发布流程。`pnpm deploy:web:build-ready` 会生成 Next.js standalone 包；在 Windows 上需启用“开发者模式”或管理员符号链接权限，也可以在 Linux/WSL 中执行。

默认应用端口为 `3157`。服务端 SQLite 位于持久化目录，不随源码发布包替换；发布脚本在切换版本前执行在线备份和迁移校验。

## 9. 文档入口

仓库只长期保留当前产品经验与设计资料：

- [P1 数字教材完整样例需求](docs/requirements/p1-digital-textbook-demo.md)
- [P1 数字教材迭代经验](docs/experience/p1-digital-textbook-lessons.md)
- [P1 图文使用教程](docs/guides/dgbook-p1-使用教程.md)
- [Image2 视觉与路由契约](docs/design/image2/README.md)
- [教材资产设计规范](docs/asset-spec.md)

日期型计划、Agent/Ralph 过程文件、验收截图副本、运行日志、历史发布包和过期部署说明不进入长期文档树。新的稳定结论应直接更新上述文档或本 README。

## 10. 清洁工作区与重新建立 Git

`node_modules/`、`apps/web/.next/`、`output/`、`artifacts/`、`.playwright-cli/`、`runtime/` 和 Python `__pycache__/` 都是可再生目录。确认没有仍在运行的本地服务后可以删除，再用 `pnpm install --frozen-lockfile` 和相应门禁恢复。

本交付目录不包含本地 `.git` 历史。需要继续使用 Git 时：

```powershell
git init -b main
git add .
git status
git commit -m "chore: initialize DGBook source"
git remote add origin <repository-url>
git push -u origin main
```

`.gitignore` 必须保留；不要用 `git add -f` 提交 SQLite、密钥、日志、构建缓存或发布包。历史版本仍以远端仓库为准。
