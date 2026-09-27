# Personal Archive：单机 Linux 安装

默认安装说明为[英文版](README.md)。在 Linux 上装好 Docker Engine 和 Docker Compose v2.24+ 后，从克隆仓库的上级目录运行：

```sh
git clone https://github.com/Alenwan/personal-archive.git
sh personal-archive/release/selfhost/install.sh
```

脚本会在同一台机器上配置应用、PostgreSQL 和 Garage 对象存储，生成只创建一次的私有 `.env`、两个私有桶并执行数据库迁移；随后交互式输入首个管理员邮箱、名称和密码。**没有默认账号或默认密码。** 再次运行不会重置账号或密钥。

安装后可在服务器本机访问 `http://127.0.0.1:8080`。默认只监听本机；其他设备需要自行配置 HTTPS 反向代理或 SSH 隧道。单节点存储没有冗余，重要资料必须另做包含数据库、两个对象桶、`.env` 和源码版本的异机备份。

在克隆仓库的上级目录执行以下账号命令；创建或重置时会隐藏密码输入，新用户首次登录须修改临时密码：

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
