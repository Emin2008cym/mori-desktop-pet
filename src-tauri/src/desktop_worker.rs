#[cfg(windows)]
mod platform {
    use base64::Engine;
    use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
    use image::{DynamicImage, ImageFormat};
    use serde_json::{json, Value};
    use std::io::Cursor;
    use std::thread;
    use std::time::Duration;
    use uiautomation::{UIAutomation, UIElement, UITreeWalker};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use xcap::Monitor;

    pub fn dispatch(command: &str, payload: &Value) -> Result<Value, String> {
        match command {
            "probe" => probe(),
            "observe" => observe(),
            "act" => act(payload),
            "shutdown" => Ok(json!({ "stopped": true })),
            _ => Err("不支持的桌面执行器请求。".into()),
        }
    }

    fn probe() -> Result<Value, String> {
        let monitors = Monitor::all().map_err(|error| format!("无法读取显示器：{error}"))?;
        if monitors.is_empty() {
            return Err("当前登录桌面没有可观察的显示器。".into());
        }
        UIAutomation::new().map_err(|error| format!("Windows UI Automation 不可用：{error}"))?;
        Enigo::new(&Settings::default())
            .map_err(|error| format!("鼠标键盘输入初始化失败：{error}"))?;
        Ok(
            json!({ "available": true, "monitorCount": monitors.len(), "lastInputTick": last_input_tick()?, "capabilities": ["screen.snapshot", "uia.read", "mouse", "keyboard"] }),
        )
    }

    fn observe() -> Result<Value, String> {
        let monitors = Monitor::all().map_err(|error| format!("屏幕截图失败：{error}"))?;
        if monitors.is_empty() {
            return Err("当前没有可观察的显示器。".into());
        }
        let mut screens = Vec::with_capacity(monitors.len());
        for monitor in monitors {
            let image = monitor
                .capture_image()
                .map_err(|error| format!("屏幕截图失败：{error}"))?;
            let (width, height) = (image.width(), image.height());
            let mut encoded = Cursor::new(Vec::new());
            DynamicImage::ImageRgba8(image)
                .write_to(&mut encoded, ImageFormat::Png)
                .map_err(|error| format!("屏幕截图编码失败：{error}"))?;
            screens.push(json!({
                "name": monitor.friendly_name().unwrap_or_default(),
                "x": monitor.x().unwrap_or(0), "y": monitor.y().unwrap_or(0),
                "width": width, "height": height,
                "image": base64::engine::general_purpose::STANDARD.encode(encoded.into_inner()),
            }));
        }
        let controls = read_control_tree()?;
        Ok(json!({ "screens": screens, "controls": controls, "lastInputTick": last_input_tick()? }))
    }

    fn read_control_tree() -> Result<Vec<Value>, String> {
        let automation = UIAutomation::new().map_err(|error| error.to_string())?;
        let walker = automation
            .get_control_view_walker()
            .map_err(|error| error.to_string())?;
        let root = automation
            .get_root_element()
            .map_err(|error| error.to_string())?;
        let mut output = Vec::new();
        collect_controls(&walker, &root, 0, &mut output);
        Ok(output)
    }

    fn collect_controls(
        walker: &UITreeWalker,
        element: &UIElement,
        depth: usize,
        output: &mut Vec<Value>,
    ) {
        if depth > 5 || output.len() >= 140 {
            return;
        }
        if let (Ok(name), Ok(rect)) = (element.get_name(), element.get_bounding_rectangle()) {
            if !name.trim().is_empty() {
                output.push(json!({
                    "name": name.chars().take(120).collect::<String>(),
                    "class": element.get_classname().unwrap_or_default().chars().take(80).collect::<String>(),
                    "role": format!("{:?}", element.get_control_type().ok()),
                    "left": rect.get_left(), "top": rect.get_top(), "right": rect.get_right(), "bottom": rect.get_bottom(),
                }));
            }
        }
        let Ok(mut child) = walker.get_first_child(element) else {
            return;
        };
        loop {
            collect_controls(walker, &child, depth + 1, output);
            if output.len() >= 140 {
                break;
            }
            match walker.get_next_sibling(&child) {
                Ok(next) => child = next,
                Err(_) => break,
            }
        }
    }

    fn act(payload: &Value) -> Result<Value, String> {
        if let Some(baseline) = payload.get("baselineInputTick").and_then(Value::as_u64) {
            if u64::from(last_input_tick()?) != baseline {
                return Ok(json!({ "applied": false, "manualTakeover": true }));
            }
        }
        let action = payload
            .get("action")
            .and_then(Value::as_str)
            .ok_or("缺少动作类型。")?;
        let mut input =
            Enigo::new(&Settings::default()).map_err(|error| format!("鼠标键盘不可用：{error}"))?;
        match action {
            "click" => {
                let (x, y) = point(payload)?;
                input
                    .move_mouse(x, y, Coordinate::Abs)
                    .map_err(input_error)?;
                let button = match payload.get("button").and_then(Value::as_str).unwrap_or("") {
                    "left" => Button::Left,
                    "right" => Button::Right,
                    "middle" => Button::Middle,
                    _ => return Err("点击按钮不在允许范围内。".into()),
                };
                let clicks = payload.get("clicks").and_then(Value::as_u64).unwrap_or(0);
                if ![1, 2].contains(&clicks) {
                    return Err("点击次数不在允许范围内。".into());
                }
                for index in 0..clicks {
                    input
                        .button(button, Direction::Click)
                        .map_err(input_error)?;
                    if index == 0 && clicks == 2 {
                        thread::sleep(Duration::from_millis(80));
                    }
                }
            }
            "drag" => {
                let (x, y) = point(payload)?;
                let (to_x, to_y) = (integer(payload, "toX")?, integer(payload, "toY")?);
                input
                    .move_mouse(x, y, Coordinate::Abs)
                    .map_err(input_error)?;
                input
                    .button(Button::Left, Direction::Press)
                    .map_err(input_error)?;
                let moved = input
                    .move_mouse(to_x, to_y, Coordinate::Abs)
                    .map_err(input_error);
                let released = input
                    .button(Button::Left, Direction::Release)
                    .map_err(input_error);
                moved?;
                released?;
            }
            "scroll" => {
                let (x, y) = point(payload)?;
                input
                    .move_mouse(x, y, Coordinate::Abs)
                    .map_err(input_error)?;
                let dx = integer(payload, "deltaX")?;
                let dy = integer(payload, "deltaY")?;
                if dx != 0 {
                    input.scroll(dx, Axis::Horizontal).map_err(input_error)?;
                }
                if dy != 0 {
                    input.scroll(dy, Axis::Vertical).map_err(input_error)?;
                }
            }
            "type" => {
                let text = payload
                    .get("text")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty() && text.chars().count() <= 1000)
                    .ok_or("输入文字无效。")?;
                input.text(text).map_err(input_error)?;
            }
            "key" => {
                let keys = payload
                    .get("keys")
                    .and_then(Value::as_array)
                    .filter(|keys| (1..=4).contains(&keys.len()))
                    .ok_or("按键组合无效。")?;
                let keys = keys
                    .iter()
                    .map(|key| {
                        key.as_str()
                            .and_then(parse_key)
                            .ok_or_else(|| "按键不在允许范围内。".to_string())
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let names = payload.get("keys").and_then(Value::as_array).unwrap();
                let names = names
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_ascii_uppercase)
                    .map(|name| match name.as_str() {
                        "META" => "WIN".to_string(),
                        "CONTROL" => "CTRL".to_string(),
                        "RETURN" => "ENTER".to_string(),
                        "ESCAPE" => "ESC".to_string(),
                        value => value.to_string(),
                    })
                    .collect::<Vec<_>>();
                let has = |key: &str| names.iter().any(|name| name == key);
                let forbidden = (names.len() == 2 && has("WIN") && has("R"))
                    || (names.len() == 3 && has("CTRL") && has("SHIFT") && has("ESC"))
                    || (names.len() == 3 && has("CTRL") && has("ALT") && has("DELETE"));
                if forbidden {
                    return Err("该系统快捷键不能由桌面任务触发。".into());
                }
                for key in &keys[..keys.len() - 1] {
                    input.key(*key, Direction::Press).map_err(input_error)?;
                }
                let final_result = input
                    .key(*keys.last().unwrap(), Direction::Click)
                    .map_err(input_error);
                for key in keys[..keys.len() - 1].iter().rev() {
                    let _ = input.key(*key, Direction::Release);
                }
                final_result?;
            }
            "wait" => {
                let milliseconds = payload
                    .get("milliseconds")
                    .and_then(Value::as_u64)
                    .filter(|value| (100..=5000).contains(value))
                    .ok_or("等待时间超出允许范围。")?;
                thread::sleep(Duration::from_millis(milliseconds));
            }
            _ => return Err("该动作不允许交由原生输入执行器处理。".into()),
        }
        Ok(json!({ "applied": true }))
    }

    fn integer(payload: &Value, key: &str) -> Result<i32, String> {
        payload
            .get(key)
            .and_then(Value::as_i64)
            .filter(|value| (-32768..=32767).contains(value))
            .map(|value| value as i32)
            .ok_or_else(|| format!("坐标或滚动值 {key} 无效。"))
    }

    fn point(payload: &Value) -> Result<(i32, i32), String> {
        Ok((integer(payload, "x")?, integer(payload, "y")?))
    }

    fn last_input_tick() -> Result<u32, String> {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return Err("无法检测用户输入状态。".into());
        }
        Ok(info.dwTime)
    }

    fn input_error(error: enigo::InputError) -> String {
        format!("Windows 输入注入失败：{error}")
    }

    fn parse_key(name: &str) -> Option<Key> {
        let key = match name.to_ascii_uppercase().as_str() {
            "ENTER" | "RETURN" => Key::Return,
            "TAB" => Key::Tab,
            "ESC" | "ESCAPE" => Key::Escape,
            "BACKSPACE" => Key::Backspace,
            "DELETE" => Key::Delete,
            "HOME" => Key::Home,
            "END" => Key::End,
            "PAGEUP" => Key::PageUp,
            "PAGEDOWN" => Key::PageDown,
            "LEFT" => Key::LeftArrow,
            "RIGHT" => Key::RightArrow,
            "UP" => Key::UpArrow,
            "DOWN" => Key::DownArrow,
            "CTRL" | "CONTROL" => Key::Control,
            "ALT" => Key::Alt,
            "SHIFT" => Key::Shift,
            "WIN" | "META" => Key::Meta,
            value if value.len() == 1 => Key::Unicode(value.chars().next()?.to_ascii_lowercase()),
            _ => return None,
        };
        Some(key)
    }
}

pub fn run() -> i32 {
    #[cfg(not(windows))]
    {
        eprintln!(
            "Mori 桌面执行目前仅支持 Windows 登录桌面；不会使用 Linux shell 或其他自动化回退。"
        );
        return 2;
    }
    #[cfg(windows)]
    {
        use std::io::{self, BufRead, Write};
        let stdin = io::stdin();
        let mut stdout = io::BufWriter::new(io::stdout().lock());
        for line in stdin.lock().lines() {
            let line = match line {
                Ok(line) => line,
                Err(_) => break,
            };
            let request: serde_json::Value = match serde_json::from_str(&line) {
                Ok(request) => request,
                Err(error) => {
                    let _ = writeln!(
                        stdout,
                        "{}",
                        serde_json::json!({ "id": null, "ok": false, "error": format!("请求格式错误：{error}") })
                    );
                    let _ = stdout.flush();
                    continue;
                }
            };
            let id = request
                .get("id")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let command = request
                .get("command")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let payload = request.get("payload").unwrap_or(&serde_json::Value::Null);
            let response = match platform::dispatch(command, payload) {
                Ok(result) => serde_json::json!({ "id": id, "ok": true, "result": result }),
                Err(error) => serde_json::json!({ "id": id, "ok": false, "error": error }),
            };
            if writeln!(stdout, "{response}")
                .and_then(|_| stdout.flush())
                .is_err()
                || command == "shutdown"
            {
                break;
            }
        }
        0
    }
}
