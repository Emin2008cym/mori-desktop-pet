#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).is_some_and(|arg| arg == "--credential-store") {
        std::process::exit(mori_desktop_pet_lib::credential_store_cli());
    }
    mori_desktop_pet_lib::run()
}
