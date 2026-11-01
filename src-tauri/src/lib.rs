use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, State};
use tauri_plugin_autostart::ManagerExt;

mod desktop_worker;

pub fn desktop_worker_cli() -> i32 {
    desktop_worker::run()
}

struct MoriBackend {
    processes: Mutex<Vec<std::process::Child>>,
    api_base: Option<String>,
    instance_id: Option<String>,
    startup_error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MoriBackendConfig {
    api_base: Option<String>,
    instance_id: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn backend_api_config(state: State<'_, MoriBackend>) -> MoriBackendConfig {
    MoriBackendConfig {
        api_base: state.api_base.clone(),
        instance_id: state.instance_id.clone(),
        error: state.startup_error.clone(),
    }
}

#[cfg(not(debug_assertions))]
fn service_is_listening(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(400)).is_ok()
}

fn backend_identity_matches(port: u16, expected_instance_id: &str) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(4)));
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    if !headers
        .lines()
        .next()
        .is_some_and(|line| line.contains(" 200 "))
    {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("serviceInstanceId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .is_some_and(|instance_id| instance_id == expected_instance_id)
}

fn wait_for_backend_port(
    stdout: std::process::ChildStdout,
    log_path: PathBuf,
    expected_instance_id: String,
) -> Result<u16, String> {
    use std::sync::mpsc;

    let (ready_tx, ready_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let Ok(mut log) = OpenOptions::new().create(true).append(true).open(log_path) else {
            return;
        };
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Some(port) = line
                .strip_prefix("MORI_READY ")
                .and_then(|value| value.trim().parse::<u16>().ok())
            {
                if backend_identity_matches(port, &expected_instance_id) {
                    let _ = ready_tx.send(port);
                }
            }
            let _ = writeln!(log, "{line}");
        }
    });
    ready_rx
        .recv_timeout(Duration::from_secs(20))
        .map_err(|error| format!("Mori 本地服务未在 20 秒内就绪：{error}"))
}

#[cfg(not(debug_assertions))]
fn find_ollama() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("OLLAMA_EXECUTABLE").map(PathBuf::from) {
        if configured.is_file() {
            return Some(configured);
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            let candidate = directory.join("ollama.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
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
            let (x, y) = app
                .primary_monitor()?
                .map(|monitor| {
                    let position = monitor.position();
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    (
                        position.x as f64 / scale + size.width as f64 / scale - 104.0,
                        position.y as f64 / scale + size.height as f64 / scale - 154.0,
                    )
                })
                .unwrap_or((1040.0, 600.0));

            tauri::WebviewWindowBuilder::new(
                app,
                "pet",
                tauri::WebviewUrl::App("index.html?pet=1".into()),
            )
            .title("Mori")
            .inner_size(84.0, 102.0)
            .position(x, y)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .shadow(false)
            .visible(true)
            .build()?;

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut managed = Vec::new();
            let log_dir = data_dir.join("logs");
            std::fs::create_dir_all(&log_dir)?;
            let mut startup_log = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(log_dir.join("startup.log"))?;
            #[cfg(not(debug_assertions))]
            if !service_is_listening(11434) {
                if let Some(ollama) = find_ollama() {
                    let mut command = Command::new(ollama);
                    #[cfg(windows)]
                    command.creation_flags(0x08000000);
                    if let Ok(child) = command
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

            #[cfg(debug_assertions)]
            let (backend_entry, backend_cwd) = {
                let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap_or(std::path::Path::new("."))
                    .to_path_buf();
                (project_root.join("server").join("index.mjs"), project_root)
            };
            #[cfg(not(debug_assertions))]
            let (node_entry, backend_entry, backend_cwd) = {
                let resources = app.path().resource_dir()?;
                let node_name = if cfg!(windows) { "node.exe" } else { "node" };
                (
                    resources.join("binaries").join(node_name),
                    resources.join("server").join("index.mjs"),
                    resources,
                )
            };

            writeln!(
                startup_log,
                "Mori backend directory: {}",
                backend_cwd.display()
            )?;
            let _stdout_log = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(log_dir.join("backend-stdout.log"))?;
            drop(_stdout_log);
            let stderr_log = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(log_dir.join("backend-stderr.log"))?;
            let instance_id = format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            #[cfg(debug_assertions)]
            let mut command = Command::new("node");
            #[cfg(not(debug_assertions))]
            let mut command = Command::new(node_entry);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let backend_result = command
                .arg(backend_entry)
                .current_dir(&backend_cwd)
                .env("MORI_DATA_DIR", &data_dir)
                .env("MORI_PORT", "0")
                .env("MORI_INSTANCE_ID", &instance_id)
                .env("MORI_EXECUTABLE", std::env::current_exe()?)
                .env("OLLAMA_URL", "http://127.0.0.1:11434")
                .env("MORI_MODEL", "qwen3.5:4b")
                .env("MORI_EMBEDDING_MODEL", "nomic-embed-text:latest")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::from(stderr_log))
                .spawn();
            let backend_state = match backend_result {
                Ok(mut backend) => {
                    writeln!(startup_log, "Mori backend PID: {}", backend.id())?;
                    let ready = match backend.stdout.take() {
                        Some(stdout) => wait_for_backend_port(
                            stdout,
                            log_dir.join("backend-stdout.log"),
                            instance_id.clone(),
                        ),
                        None => Err("Mori backend stdout pipe is unavailable.".to_string()),
                    };
                    match ready {
                        Ok(port) => {
                            managed.push(backend);
                            MoriBackend {
                                processes: Mutex::new(managed),
                                api_base: Some(format!("http://127.0.0.1:{port}")),
                                instance_id: Some(instance_id),
                                startup_error: None,
                            }
                        }
                        Err(error) => {
                            let _ = backend.kill();
                            let message = format!("无法启动 Mori 本地服务：{error}");
                            let _ = writeln!(startup_log, "{message}");
                            MoriBackend {
                                processes: Mutex::new(managed),
                                api_base: None,
                                instance_id: None,
                                startup_error: Some(message),
                            }
                        }
                    }
                }
                Err(error) => {
                    let message = format!("无法启动 Mori 本地服务：{error}");
                    writeln!(startup_log, "{message}")?;
                    MoriBackend {
                        processes: Mutex::new(managed),
                        api_base: None,
                        instance_id: None,
                        startup_error: Some(message),
                    }
                }
            };
            app.manage(backend_state);

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
                    } = event
                    {
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
        .invoke_handler(tauri::generate_handler![backend_api_config])
        .build(tauri::generate_context!())
        .expect("failed to build Mori desktop pet")
        .run(|_app, event| {
            if matches!(event, RunEvent::Exit) {
                {
                    if let Some(backend) = _app.try_state::<MoriBackend>() {
                        if let Ok(mut processes) = backend.processes.lock() {
                            for child in processes.iter_mut() {
                                let _ = child.kill();
                            }
                        }
                    }
                }
            }
        });
}
