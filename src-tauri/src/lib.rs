use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

mod credential_store;

pub fn credential_store_cli() -> i32 {
    credential_store::run()
}

struct MoriBackend(Mutex<Vec<Child>>);

fn service_is_listening(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(400)).is_ok()
}

fn find_ollama() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("OLLAMA_EXECUTABLE").map(PathBuf::from) {
        if configured.is_file() { return Some(configured); }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            let candidate = directory.join("ollama.exe");
            if candidate.is_file() { return Some(candidate); }
        }
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Programs").join("Ollama").join("ollama.exe"))
        .filter(|path| path.is_file())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--pet-only"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let (x, y) = app.primary_monitor()?.map(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                let scale = monitor.scale_factor();
                (
                    position.x as f64 / scale + size.width as f64 / scale - 170.0,
                    position.y as f64 / scale + size.height as f64 / scale - 190.0,
                )
            }).unwrap_or((1040.0, 600.0));

            tauri::WebviewWindowBuilder::new(
                app,
                "pet",
                tauri::WebviewUrl::App("index.html?pet=1".into()),
            )
            .title("Mori")
            .inner_size(150.0, 170.0)
            .position(x, y)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .shadow(false)
            .visible(true)
            .build()?;

            WebviewWindowBuilder::new(
                app,
                "chat",
                tauri::WebviewUrl::App("index.html?chat=1".into()),
            )
            .title("Mori 对话")
            .inner_size(440.0, 650.0)
            .position(x - 450.0, y - 155.0)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .shadow(false)
            .visible(false)
            .build()?;

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            #[cfg(not(debug_assertions))]
            {
                let mut managed = Vec::new();
                if !service_is_listening(11434) {
                    if let Some(ollama) = find_ollama() {
                        if let Ok(child) = Command::new(ollama)
                            .arg("serve")
                            .stdin(Stdio::null())
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .spawn()
                        {
                            managed.push(child);
                        }
                    }
                }
                let resources = app.path().resource_dir()?;
                let backend_entry = resources.join("server").join("index.mjs");
                let node_name = if cfg!(windows) { "node.exe" } else { "node" };
                let node_entry = resources.join("binaries").join(node_name);
                let backend = Command::new(node_entry)
                    .arg(backend_entry)
                    .current_dir(&resources)
                    .env("MORI_DATA_DIR", &data_dir)
                    .env("MORI_PORT", "4179")
                    .env("MORI_CREDENTIAL_EXECUTABLE", std::env::current_exe()?)
                    .env("OLLAMA_URL", "http://127.0.0.1:11434")
                    .env("MORI_MODEL", "qwen3.5:4b")
                    .env("MORI_EMBEDDING_MODEL", "nomic-embed-text:latest")
                    .env("MORI_AUTOCONNECT_OPENCLAW", "1")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()?;
                managed.push(backend);
                app.manage(MoriBackend(Mutex::new(managed)));
            }

            let show_item = MenuItem::with_id(app, "show", "打开 Mori 工作台", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 Mori", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::new()
                .tooltip("Mori 私人智能体")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            #[cfg(debug_assertions)]
            app.autolaunch().disable()?;
            #[cfg(not(debug_assertions))]
            app.autolaunch().enable()?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" || window.label() == "chat" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    builder
        .build(tauri::generate_context!())
        .expect("failed to build Mori desktop pet")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(backend) = app.try_state::<MoriBackend>() {
                    if let Ok(mut processes) = backend.0.lock() {
                        for child in processes.iter_mut() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
