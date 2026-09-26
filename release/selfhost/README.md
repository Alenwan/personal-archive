# Personal Archive Alpha：源码安装

这是首发安装候选，适合个人或可信家庭网络试用。已在 Linux/arm64、Docker 和 Garage S3 上完成一轮首装、重启与空实例恢复验收，具体范围见[验证记录](VALIDATION.md)；当前没有正式发行镜像。先使用可重新取得的测试资料完成下面的验收。

此路径提供应用和 PostgreSQL，需要已有的 S3 兼容服务及两个专用私有桶。它不会安装对象存储服务、迁移旧实例或导入演示账号。

## 准备

- Docker Engine / Docker Desktop，以及 Docker Compose 2.24 或更新版本。
- 一份完整源码。以下命令从源码的 `release/selfhost` 目录执行。
- 两个不同且初始为空的私有桶：一个存放文件，一个存放应用备份对象。凭据至少具有两个桶的 ListBucket、GetObject、PutObject、DeleteObject 权限。关闭公共访问，不配置自动删除对象的生命周期规则。
- S3 endpoint 必须能从容器访问。容器里的 `localhost` 指向容器自身；远程连接使用有效 HTTPS 证书。自行管理的对象后端需要另外维护和备份。

## 安装

1. 进入安装目录并生成配置。以下命令仅生成一次随机数据库密码、实例标识和三个独立数据密钥；已存在的 `.env` 会被保留并拒绝覆盖。

   ```sh
   cd release/selfhost
   docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/setup" -w /setup node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df node configure.mjs
   ```

   如本机已安装 Node 24，也可在同一目录直接运行 `node configure.mjs`。`.env` 的文件权限为 0600。用本地编辑器填写 `S3_ENDPOINT`、S3 凭据和两个桶名；保留单引号以避免 `$` 被解释成变量。凭据包含单引号时，按 [Compose 环境文件语法](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)转义。不要更改生成的数据库密码或密钥，也不要将 `.env` 加入 Git。

2. 验证配置并构建。`--quiet` 不会显示展开后的秘密配置。

   ```sh
   docker compose config --quiet
   docker compose build app
   docker compose up -d postgres
   docker compose run --rm app node dist-server/migrate.mjs
   ```

   迁移命令成功后才继续。没有自动 seed，也不在每次服务启动时自动迁移。

3. 创建第一个管理员。密码不回显，需要输入两次；无默认密码、公开注册或邮件依赖。

   ```sh
   docker compose run --rm app node dist-server/init-admin.mjs --email owner@example.org --name "Archive Owner"
   docker compose up -d app
   docker compose ps
   curl --fail http://127.0.0.1:8080/healthz
   curl --fail http://127.0.0.1:8080/readyz
   ```

   把示例邮箱换成自己的登录邮箱，无需在 Alpha 中验证邮件。已有任何真实账号时初始化会拒绝执行，不能拿它重置旧账号。若修改了 `APP_PORT`，同步调整访问 URL。

4. 在同一台电脑打开 <http://localhost:8080> 并登录。确认上传、预览和下载同一份测试文件，保存一条笔记和一章长文，再执行 `docker compose restart app`，重新登录并核对数据仍可读取。启用 Vault/加密长文时，另行保存其独立密码并验证解锁。

应用端口固定绑定宿主机回环地址，PostgreSQL 不向宿主机发布端口。需要从其他电脑访问时，通过自己管理的 HTTPS 反向代理或 SSH 隧道访问；代理应覆盖来自客户端的 `X-Forwarded-Proto` / `X-Forwarded-Host`，传递正确的 HTTPS 来源，并允许所需上传大小。非 localhost 的浏览器加密功能需要安全上下文。此配置不是公网服务部署方案。

## 数据放在哪里

构建同时生成前端与服务端的第三方组件清单和许可原文，随镜像的 `dist`、`dist-server` 保存。前端可访问 `/THIRD_PARTY_NOTICES.txt`；服务端可用 `docker compose exec -T app cat dist-server/THIRD_PARTY_NOTICES.txt` 读取。收集范围及来源见[许可说明](../licenses/README.md)，容器系统包和素材仍需单独审阅。

PostgreSQL 使用 Compose 项目内的 `postgres-data` 命名卷，文件和应用备份对象位于上述 S3 桶。`.env` 中的项目名决定卷身份；保留它，避免启动成另一个空实例。`docker compose stop` 或不带 `--volumes` 的 `down` 会保留命名卷；不要使用 `down --volumes` 删除已有数据。

实例密钥、账号登录密码、Vault/长文的独立密码各有不同用途。恢复服务器密钥可能用于辅助恢复，因此不宣称服务器运营者绝对无法解密。不要通过重新生成 `.env` 修复登录或解锁问题。

## 备份和升级

应用的备份页面不等于完整灾难恢复。完整恢复集合必须同时保留：PostgreSQL 原生 dump、两只桶的完整对象及校验清单、加密保管的 `.env`/恢复材料，以及对应源码版本。至少保留一份离开服务器磁盘的加密副本。

在预定维护窗口停止应用，等待停止完成，同时禁止其他工具写入该数据库和两个桶。保持数据库和 S3 服务运行，取得同一静止状态的备份。例如数据库部分可在受保护的独立目录中执行：

```sh
docker compose stop app
umask 077
RECOVERY_DIR=$(mktemp -d ./recovery-XXXXXX)
docker compose exec -T postgres pg_dump -U archive -d archive -Fc > "$RECOVERY_DIR/database.dump"
```

必须确认命令成功，再用对象后端的工具导出两只桶的全部对象、校验大小/摘要，并加密保存配置与版本信息。上述命令仅完成数据库部分；不要把尚未齐全或未验证的集合当作可恢复备份，也不要打包运行中的 PostgreSQL 数据目录。原始 dump 含账号和资料元数据，应按个人资料保护。完成后再启动应用。

升级前应在隔离空实例上证明这个集合可恢复。保留原 `.env`、卷和桶，在维护状态构建候选代码、运行其迁移，再启动应用并检查 `/readyz`、`/healthz`、登录和代表性资料。回退不能只切回旧镜像：新 schema 可能不兼容旧代码，需要匹配的数据库、对象、密钥和代码，并另外保全升级后的新写入。旧实例导入不属于本安装指南。

## 故障排查与限制

- `config --quiet` 报缺少变量：填完当前目录的 `.env`。不要把完整 `docker compose config` 输出或 `.env` 贴到公开 issue。
- 迁移失败：检查数据库连接与源码版本，查看脱敏错误。不要自动采用未知迁移校验和。
- 应用拒绝启动或 `/readyz` 为 503：检查迁移是否成功、S3 endpoint/桶名、两个桶的读写删除权限和三个数据密钥。应用会探测两个存储是否可写；仅 `/healthz` 为 200 不代表已就绪。
- 忘记登录密码：由服务器维护者使用发行版的 `set-user-password.mjs` 为原账号恢复登录；这与 Vault/长文密码恢复不同。首管理员初始化不会覆盖已有账号。
- 普通 Archive、笔记和普通长文按实例共享读取；Vault 按账号隔离。邀请邮件、完整成员管理和任意目录 ACL 尚未提供。
- 文件引用采取保留策略。存在加密长文或密文章节历史时，永久清理文件暂停，回收站和恢复仍可用，因此可能持续占用存储空间。
- 当前只提供源码构建；未承诺所有 S3 实现、NAS 或 CPU 平台均通过验证。基础镜像固定版本和摘要，后续版本需主动更新并重新测试。

Compose 的环境、依赖和卷语义以 [Docker 官方文档](https://docs.docker.com/reference/compose-file/services/)为准。
