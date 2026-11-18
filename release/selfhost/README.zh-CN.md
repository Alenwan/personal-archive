# Personal Archive：单机 Linux 安装

默认安装说明为[英文版](README.md)。全新 Debian 12 或 13 服务器可以直接从克隆仓库的上级目录运行：

```sh
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/Alenwan/personal-archive.git
sudo sh personal-archive/release/selfhost/debian-install.sh
```

此入口使用 Docker 官方 Debian 软件源安装 Docker Engine、Compose 和备份用的 `age`，再启动应用安装。若服务器已安装冲突的容器软件包，脚本会停止并提示按 Docker 官方指南处理，不会替你卸载。需要交互式终端输入管理员密码。

如果 Linux 已有 Docker Engine 和 Docker Compose v2.24+，则使用标准入口：

```sh
git clone https://github.com/Alenwan/personal-archive.git
sh personal-archive/release/selfhost/install.sh
```

脚本会在同一台机器上配置应用、PostgreSQL 和 Garage 对象存储，生成只创建一次的私有 `.env`、两个私有桶并执行数据库迁移；随后交互式输入首个管理员用户名、名称和密码，不要求邮箱。用户名以小写字母开头，长 3–32 位，可包含小写字母、数字、点、下划线和连字符。**没有默认账号或默认密码。** 新安装会自动选择服务器的局域网 IPv4 地址；再次运行不会重置账号或密钥。

安装后，在同一局域网的设备上打开安装器显示的地址，例如 `http://192.168.3.48:8080`。应用只绑定选中的私有 IP；PostgreSQL 和 Garage 不开放主机端口。已有的本机绑定安装可在克隆仓库的上级目录执行 `sudo sh personal-archive/release/selfhost/network.sh lan`，只重建应用容器即可开放局域网访问；多网卡时可在命令后指定私有 IPv4 地址，`network.sh local` 可切回仅本机访问。HTTP 不加密登录密码、Cookie 和文件传输，请只在可信局域网使用，并阻止公网访问 8080 端口；需要安全上下文的浏览器功能或跨不可信网络访问时应配置 HTTPS。单节点存储没有冗余，重要资料必须另做包含数据库、两个对象桶、`.env` 和源码版本的异机备份。

在克隆仓库的上级目录执行以下账号命令；创建或重置时会隐藏密码输入，新用户首次登录须修改临时密码。若首次安装使用了 `sudo`，后续账号、备份、校验与恢复命令也应使用 `sudo`，不要修改私有 `.env` 的权限：

```sh
sh personal-archive/release/selfhost/accounts.sh list
sh personal-archive/release/selfhost/accounts.sh create --username person --name "Person"
sh personal-archive/release/selfhost/accounts.sh reset-password --username person
```

已有邮箱账号可运行 `accounts.sh set-username --email old@example.org --username alen`，在原账号上设置用户名；文件、Private vault 和密码不变，现有登录会话失效。未设置用户名的旧账号仍可用邮箱登录。默认新用户角色为 `Staff`，可用 `--role ReadOnly` 创建只读账号。普通档案按实例共享，Private vault 按账号隔离。外部 S3、升级、备份和故障处理的完整说明以[英文安装指南](README.md)为准。

默认单机安装可使用下面的加密备份与校验命令。先在 Linux 主机上安装 `age`；备份时应用会短暂暂停写入，命令会提示设置独立的备份密码。请把加密文件复制到另一台设备，并保管好密码。

```sh
sh personal-archive/release/selfhost/backup.sh --output /mnt/backups/personal-archive.age
sh personal-archive/release/selfhost/verify-backup.sh /mnt/backups/personal-archive.age
```

恢复时，在全新的 Linux 主机上检出备份记录的源码提交，**先运行恢复命令，不要先运行安装脚本**：

```sh
sh release/selfhost/restore.sh --archive /mnt/backups/personal-archive.age
```

恢复脚本拒绝覆盖已有 `.env`、容器或数据卷。由于新主机的私有 IP 可能不同，恢复时先绑定本机地址；确认数据后运行 `sh release/selfhost/network.sh lan` 开放给新局域网。校验成功仍需登录并检查原文件、笔记和长文。详见[英文指南的备份与恢复章节](README.md#back-up-and-recover-the-bundled-installation)。
