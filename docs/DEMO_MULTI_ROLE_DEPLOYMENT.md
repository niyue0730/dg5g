# DGBook 多角色公网演示部署说明

## 1. 目标

教师、学生和投屏页面需要同时在线，并共享同一课堂状态。教师登录不能覆盖学生登录，学生登录也不能使演示控制台失效。

推荐入口：

| 角色 | 示例入口 | 登录身份 |
| --- | --- | --- |
| 公共页 | `https://demo.example.com` | 无 |
| 教师端与控制台 | `https://teacher.demo.example.com` | `teacher01` |
| 学生端 | `https://student.demo.example.com` | `student03` |
| 投屏端 | `https://teacher.demo.example.com` | 教师身份 |

三个入口应指向同一个 Next.js 应用。教师端和学生端必须使用不同主机名，因为浏览器 Cookie 不按端口隔离。投屏端与教师端身份相同，默认共用教师端主机和会话；需要独立投屏域名时再增加 `screen.demo.example.com`。

## 2. 应用配置

在服务器的 `/etc/dgbook-web.env` 中配置：

```dotenv
DGBOOK_TRUST_PROXY=1
DGBOOK_DEMO_PUBLIC_ORIGIN=https://demo.example.com
DGBOOK_DEMO_TEACHER_ORIGIN=https://teacher.demo.example.com
DGBOOK_DEMO_STUDENT_ORIGIN=https://student.demo.example.com
DGBOOK_DEMO_PROJECTOR_ORIGIN=https://teacher.demo.example.com
```

入口变量只能包含协议、主机名和可选端口。公网入口必须使用 HTTPS。演示控制台会检查教师端与学生端是否真正隔离；配置缺失或主机名相同时，学生步骤会被阻止并显示错误。

本地开发无需配置上述入口。控制台会在 `127.0.0.1` 与 `localhost` 之间自动隔离教师、学生 Cookie。

## 3. DNS、TLS 与反向代理

三个域名解析到同一网关。TLS 证书应覆盖全部域名，可以使用包含三个名称的 SAN 证书或受控的通配符证书。

Nginx 可使用同一上游：

```nginx
server {
    listen 443 ssl http2;
    server_name
        demo.example.com
        teacher.demo.example.com
        student.demo.example.com;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:3157;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

80端口只做 HTTPS 跳转。不得由外部请求自行决定受信任代理头；`DGBOOK_TRUST_PROXY=1` 只应在受控反向代理之后启用。

## 4. 登录与 Cookie

当前会话 Cookie 是 `HttpOnly`、`SameSite=Lax`、`Path=/`，且不设置 `Domain`。因此 Cookie 只属于当前主机：

- 教师在 `teacher.demo.example.com` 登录一次。
- 学生在 `student.demo.example.com` 登录一次。
- 后续演示步骤复用命名窗口，不再反复登出和登录。
- 投屏端与教师端使用同一主机和教师身份，但保留独立命名窗口，因此无需增加一次登录。

不得把演示密码写入前端、URL或本地存储。若以后要求“一次点击、首次也无需登录”，应单独实现短时一次性启动票据：由教师端签发，限定角色、目标主机、返回路径和60秒有效期，目标端兑换后立即作废并建立普通会话。

## 5. 数据与课堂状态

所有域名必须连接同一个数据源，否则教师翻页、投屏和学生跟随会出现不同步。

- 单机演示可继续使用当前 SQLite 数据库和单个应用进程。
- 多实例或多服务器部署不应复制各自的 SQLite 文件，应改用共享数据库和共享会话/事件存储。
- 课堂助手启用时，所有入口必须指向同一课堂会话 `demo-class`，并使用相同的 `DGBOOK_HELPER_TOKEN`。
- 发布前执行数据库迁移、演示数据恢复和数据库验证。

## 6. 上线门禁

发布后逐项验收：

1. 三个域名均只通过 HTTPS 访问，HTTP 自动跳转。
2. 三个域名的 `/api/build-info` 返回同一发布版本。
3. 教师端登录后，学生端登录不会改变教师端 `/api/auth/me` 的身份。
4. 演示控制台“检查系统”显示五项通过，其中“角色窗口”为“教师/学生已隔离”。
5. 连续执行九步演示，学生步骤复用一个学生窗口，教师和投屏步骤分别复用各自窗口。
6. 教师切页后，投屏端与学生课堂跟随端显示同一活动和版本。
7. 刷新三个窗口后，登录身份、当前节点和课堂状态保持正确。
8. 执行“恢复演示基线”后，三名演示学生和课堂状态恢复到规定快照。
9. 使用无痕窗口验证未登录访问会被角色守卫拦截，控制台不能被学生账号打开。
10. 保存上线前数据库备份、发布版本号和回滚版本，并完成一次回滚演练。

## 7. 当前边界

应用代码已经支持环境变量驱动的角色入口和错误阻断。仓库现有自动部署脚本仍以单个 `server_name` 为默认模板；正式发布多子域前，需要按本说明配置多域名 Nginx，或再扩展自动部署脚本生成同等配置。未经真实域名、TLS和三端联动验收，不能宣称公网演示已经可用。
