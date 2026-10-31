use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

const SERVICE: &str = "local.mori.desktop-pet.openclaw";
const MAX_REQUEST_BYTES: u64 = 16 * 1024;

#[derive(Deserialize)]
struct Request {
    action: String,
    account: String,
    value: Option<String>,
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    value: Option<String>,
}

fn valid_account(account: &str) -> bool {
    !account.is_empty()
        && account.len() <= 256
        && account.bytes().all(|byte| byte.is_ascii_alphanumeric() || b":_-".contains(&byte))
        && (account == "gateway-device-identity" || account.starts_with("device-token:"))
}

fn execute(request: Request) -> Result<Option<String>, ()> {
    if !valid_account(&request.account) {
        return Err(());
    }

    let entry = Entry::new(SERVICE, &request.account).map_err(|_| ())?;
    match request.action.as_str() {
        "get" => match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(()),
        },
        "set" => {
            let value = request.value.ok_or(())?;
            if value.len() > 2400 {
                return Err(());
            }
            entry.set_password(&value).map_err(|_| ())?;
            Ok(None)
        }
        "delete" => match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(()),
        },
        _ => Err(()),
    }
}

pub fn run() -> i32 {
    let mut input = String::new();
    if std::io::stdin()
        .take(MAX_REQUEST_BYTES)
        .read_to_string(&mut input)
        .is_err()
    {
        return 1;
    }

    let result = serde_json::from_str::<Request>(&input)
        .map_err(|_| ())
        .and_then(execute);
    let response = match result {
        Ok(value) => Response { ok: true, value },
        Err(()) => Response { ok: false, value: None },
    };

    let mut output = std::io::stdout().lock();
    if serde_json::to_writer(&mut output, &response).is_err() || output.write_all(b"\n").is_err() {
        return 1;
    }
    if response.ok { 0 } else { 1 }
}
