mod store;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use store::{Page, Store};
use tauri::{Emitter, Manager};

struct AppState {
    // Keep startup failures visible in the UI, without replacing an unreadable DB.
    store: Mutex<Result<Store, String>>,
    exit_allowed: AtomicBool,
}

#[tauri::command]
fn load_page(date: String, state: tauri::State<AppState>) -> Result<Option<Page>, String> {
    let guard = state
        .store
        .lock()
        .map_err(|_| "저장소에 접근할 수 없습니다.")?;
    guard.as_ref().map_err(Clone::clone)?.load(&date)
}

#[tauri::command]
fn save_page(page: Page, state: tauri::State<AppState>) -> Result<(), String> {
    let mut guard = state
        .store
        .lock()
        .map_err(|_| "저장소에 접근할 수 없습니다.")?;
    guard.as_mut().map_err(|e| e.clone())?.save(&page)
}

#[tauri::command]
fn quit_after_save(app: tauri::AppHandle, state: tauri::State<AppState>) {
    state.exit_allowed.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let store = (|| {
                let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
                std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
                Store::open(&directory.join("sagak.sqlite3"))
            })();
            app.manage(AppState {
                store: Mutex::new(store),
                exit_allowed: AtomicBool::new(false),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("save-before-exit", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_page,
            save_page,
            quit_after_save
        ])
        .build(tauri::generate_context!())
        .expect("사각 앱을 시작할 수 없습니다.");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<AppState>().exit_allowed.load(Ordering::SeqCst) {
                api.prevent_exit();
                let _ = app.emit("save-before-exit", ());
            }
        }
    });
}
