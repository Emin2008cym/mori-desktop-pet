# Mori 本机开发版安装

此安装包用于在开发者自己的 Windows 账户中运行 Mori，不是面向其他用户的发行版。

1. 从 GitHub 仓库的 **Actions > Windows build** 下载 `mori-windows-dev-payload`，并解压 `Mori-Dev-Payload.zip`。
2. 确认 Windows SDK 已安装，然后在解压目录打开终端运行 `node install-mori-dev.mjs`。
3. 查看屏幕上的信任范围说明；确认后输入 `YES`。安装器会生成 Mori 专用证书，只添加到当前账户的 `TrustedPeople`，然后签署本机稀疏 MSIX 并注册 Mori 包身份。
4. 从开始菜单打开 **Mori Desktop Pet**。

安装器不关闭 Smart App Control，不修改机器级证书库或 `Trusted Root`，不需要管理员权限。私钥留在当前用户证书库，不导出。安装失败时会清理本次新建且未用于成功注册的证书；不会降低 Windows 安全策略。

更新时下载较新的 payload，再运行其中的安装器。卸载时运行 `node uninstall-mori-dev.mjs`；Mori 的聊天、知识库和设置数据保留在应用数据目录。

开发者证书是本机私有开发信任，不能用于公开分发。要让其他用户安装运行，仍需通过受信任 CA 或 Microsoft Store 的发行签名路径。
