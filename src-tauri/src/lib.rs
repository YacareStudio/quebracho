pub mod commands;
pub mod models;
pub mod providers;
pub mod state;
pub mod storage;
pub mod utils;

use once_cell::sync::Lazy;

pub static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::new()
});
