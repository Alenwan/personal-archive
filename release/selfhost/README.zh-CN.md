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

脚本会在同一台机器上配置应用、PostgreSQL 和 Garage 对象存储，生成只创建一次的私有 `.env`、两个私有桶并执行数据库迁移；随后交互式输入首个管理员邮箱、名称和密码。**没有默认账号或默认密码。** 再次运行不会重置账号或密钥。

安装后可在服务器本机访问 `http://127.0.0.1:8080`。默认只监听本机；可在自己的电脑上执行 `ssh -L 8080:127.0.0.1:8080 user@服务器地址`，然后在该电脑打开 `http://127.0.0.1:8080`。其他设备常规访问需自行配置 HTTPS 反向代理。单节点存储没有冗余，重要资料必须另做包含数据库、两个对象桶、`.env` 和源码版本的异机备份。

在克隆仓库的上级目录执行以下账号命令；创建或重置时会隐藏密码输入，新用户首次登录须修改临时密码。若首次安装使用了 `sudo`，后续账号、备份、校验与恢复命令也应使用 `sudo`，不要修改私有 `.env` 的权限：

```sh
sh personal-archive/release/selfhost/accounts.sh list
sh personal-archive/release/selfhost/accounts.sh create --email person@example.org --name "Person"
sh personal-archive/release/selfhost/accounts.sh reset-password --email person@example.org
```

默认新用户角色为 `Staff`，可用 `--role ReadOnly` 创建只读账号。普通档案按实例共享，Private vault 按账号隔离。外部 S3、升级、备份和故障处理的完整说明以[英文安装指南](README.md)为准。

默认单机安装可使用下面的加密备份与校验命令。先在 Linux 主机上安装 `age`；备份时应用会短暂暂停写入，命令会提示设置独立的备份密码。请把加密文件复制到另一台设备，并保管好密码。

```sh
sh personal-archive/release/selfhost/backup.sh --output /mnt/backups/personal-archive.age
sh personal-archive/release/selfhost/verify-backup.sh /mnt/backups/personal-archive.age
```

恢复时，在全新的 Linux 主机上检出备份记录的源码提交，**先运行恢复命令，不要先运行安装脚本**：

```sh
sh release/selfhost/restore.sh --archive /mnt/backups/personal-archive.age
```

恢复脚本拒绝覆盖已有 `.env`、容器或数据卷。校验成功仍需登录并检查原文件、笔记和长文。详见[英文指南的备份与恢复章节](README.md#back-up-and-recover-the-bundled-installation)。
