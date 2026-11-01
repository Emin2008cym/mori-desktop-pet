# Mori 本机开发版

1. 解压 GitHub Actions 的 `mori-windows-dev-payload`，再解压里面的 `Mori-Dev-Payload.zip`。
2. 进入包含 `install-Mori.cmd` 和 `mori-desktop-pet.exe` 的目录，双击 `install-Mori.cmd`。更新前先退出 Mori。
3. 安装后，双击 Windows 桌面的 **Mori 桌宠**。后续不需要终端、浏览器或手动启动服务器。

程序安装在当前用户的 `%LOCALAPPDATA%\Programs\MoriDev`。人物大小固定；悬停显示贴边快捷入口，点击人物在同一面板聊天，按住人物或顶部移动柄拖动，按 Escape 或关闭按钮收起。

此路径复制普通 Win32 程序及资源，不导入证书、不注册 MSIX、不改 SAC。它已在开发者当前机器通过启动验证，但不保证其他机器的应用控制策略放行；如被策略拦截，应保留策略并处理发行签名。

启动日志位于 `%APPDATA%\local.mori.desktop-pet\logs`。对话、知识库和凭据均留在本机。卸载时先退出 Mori，然后在安装目录运行 `binaries\node.exe uninstall-mori-dev.mjs` 并确认；聊天和知识库保留。
