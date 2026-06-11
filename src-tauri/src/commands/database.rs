use crate::models::{DbConnection, DbConnectionsFile, DbQueryResult};
use sqlx::{Connection as SqlxConnection, Row};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn connections_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir error: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir config dir error: {e}"))?;
    Ok(dir.join("database-connections.json"))
}

fn build_sqlx_url(conn: &DbConnection) -> Result<String, String> {
    match conn.db_type.as_str() {
        "mysql" => {
            let host = conn.host.as_deref().unwrap_or("localhost");
            let port = conn.port.unwrap_or(3306);
            let user = conn.user.as_deref().unwrap_or("");
            let pass = conn.password.as_deref().unwrap_or("");
            let db = conn.database.as_deref().unwrap_or("");
            Ok(format!(
                "mysql://{}:{}@{}:{}/{}",
                urlencoding::encode(user),
                urlencoding::encode(pass),
                host,
                port,
                db
            ))
        }
        "postgresql" => {
            let host = conn.host.as_deref().unwrap_or("localhost");
            let port = conn.port.unwrap_or(5432);
            let user = conn.user.as_deref().unwrap_or("");
            let pass = conn.password.as_deref().unwrap_or("");
            let db = conn.database.as_deref().unwrap_or("");
            Ok(format!(
                "postgres://{}:{}@{}:{}/{}",
                urlencoding::encode(user),
                urlencoding::encode(pass),
                host,
                port,
                db
            ))
        }
        "sqlite" => {
            let path = conn
                .file_path
                .as_deref()
                .ok_or("sqlite file path required")?;
            Ok(format!("sqlite:{}", path))
        }
        other => Err(format!("unsupported db type for sqlx: {}", other)),
    }
}

#[tauri::command]
pub async fn db_test_connection(conn: DbConnection) -> Result<bool, String> {
    match conn.db_type.as_str() {
        "sqlite" => {
            let path = conn.file_path.as_deref().ok_or("sqlite file path required")?;
            Ok(std::path::Path::new(path).exists())
        }
        "mysql" | "postgresql" => {
            let url = build_sqlx_url(&conn)?;
            match <sqlx::AnyConnection as SqlxConnection>::connect(&url).await {
                Ok(c) => {
                    let _ = c.close().await;
                    Ok(true)
                }
                Err(e) => Err(format!("connection failed: {}", e)),
            }
        }
        "sqlserver" => {
            test_sqlserver(&conn).await.map(|_| true)
        }
        other => Err(format!("unsupported db type: {}", other)),
    }
}

#[tauri::command]
pub async fn db_execute_query(
    conn: DbConnection,
    query: String,
) -> Result<DbQueryResult, String> {
    match conn.db_type.as_str() {
        "sqlite" => execute_sqlite_query(conn, query).await,
        "mysql" | "postgresql" => execute_sqlx_query(conn, query).await,
        "sqlserver" => execute_sqlserver_query(conn, query).await,
        other => Err(format!("unsupported db type: {}", other)),
    }
}

async fn execute_sqlx_query(
    conn: DbConnection,
    query: String,
) -> Result<DbQueryResult, String> {
    let url = build_sqlx_url(&conn)?;
    let mut connection = <sqlx::AnyConnection as SqlxConnection>::connect(&url)
        .await
        .map_err(|e| format!("connect failed: {}", e))?;

    let rows = sqlx::query(&query)
        .fetch_all(&mut connection)
        .await
        .map_err(|e| format!("query failed: {}", e))?;

    let columns = if let Some(first) = rows.first() {
        first.columns.iter().map(|c| c.name.to_string()).collect()
    } else {
        vec![]
    };

    let mut result_rows = Vec::new();
    for row in rows {
        let mut result_row = Vec::new();
        for i in 0..columns.len() {
            let val = if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                v
            } else if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                v.map(|n| n.to_string())
            } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
                v.map(|n| n.to_string())
            } else if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
                v.map(|n| n.to_string())
            } else {
                None
            };
            result_row.push(val);
        }
        result_rows.push(result_row);
    }

    let _ = connection.close().await;

    Ok(DbQueryResult {
        columns,
        rows: result_rows,
    })
}

async fn execute_sqlite_query(
    conn: DbConnection,
    query: String,
) -> Result<DbQueryResult, String> {
    let path = conn.file_path.as_deref().ok_or("sqlite file path required")?;
    let url = format!("sqlite:{}", path);
    let mut connection = <sqlx::AnyConnection as SqlxConnection>::connect(&url)
        .await
        .map_err(|e| format!("open sqlite failed: {}", e))?;

    let rows = sqlx::query(&query)
        .fetch_all(&mut connection)
        .await
        .map_err(|e| format!("query failed: {}", e))?;

    let columns = if let Some(first) = rows.first() {
        first.columns.iter().map(|c| c.name.to_string()).collect()
    } else {
        vec![]
    };

    let mut result_rows = Vec::new();
    for row in rows {
        let mut result_row = Vec::new();
        for i in 0..columns.len() {
            let val = if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                v
            } else if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                v.map(|n| n.to_string())
            } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
                v.map(|n| n.to_string())
            } else if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
                v.map(|n| n.to_string())
            } else {
                None
            };
            result_row.push(val);
        }
        result_rows.push(result_row);
    }

    let _ = connection.close().await;

    Ok(DbQueryResult {
        columns,
        rows: result_rows,
    })
}

async fn test_sqlserver(conn: &DbConnection) -> Result<(), String> {
    use tokio_util::compat::TokioAsyncWriteCompatExt;
    let host = conn.host.as_deref().unwrap_or("localhost");
    let port = conn.port.unwrap_or(1433);
    let addr = format!("{}:{}", host, port);
    let tcp = tokio::net::TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("sqlserver connection failed: {}", e))?;
    let _ = tcp.compat_write();
    Ok(())
}

async fn execute_sqlserver_query(
    conn: DbConnection,
    query: String,
) -> Result<DbQueryResult, String> {
    use tiberius::{Client, Config};
    use tokio_util::compat::TokioAsyncWriteCompatExt;

    let host = conn.host.as_deref().unwrap_or("localhost");
    let port = conn.port.unwrap_or(1433);
    let user = conn.user.as_deref().unwrap_or("");
    let pass = conn.password.as_deref().unwrap_or("");
    let db = conn.database.as_deref().unwrap_or("");

    let mut config = Config::new();
    config.host(host);
    config.port(port);
    if !user.is_empty() {
        config.authentication(tiberius::AuthMethod::sql_server(user, pass));
    }
    if !db.is_empty() {
        config.database(db);
    }
    config.trust_cert();

    let tcp = tokio::net::TcpStream::connect(format!("{}:{}", host, port))
        .await
        .map_err(|e| format!("connect failed: {}", e))?;
    tcp.set_nodelay(true).map_err(|e| format!("set_nodelay failed: {}", e))?;

    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| format!("client connect failed: {}", e))?;

    let stream = client
        .simple_query(&query)
        .await
        .map_err(|e| format!("query failed: {}", e))?;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();

    for result in stream.into_first_result().await.map_err(|e| format!("result failed: {}", e))? {
        if columns.is_empty() {
            for col in result.columns() {
                columns.push(col.name().to_string());
            }
        }
        let mut row_vals = Vec::new();
        for i in 0..columns.len() {
            let val: Option<&str> = result.try_get(i).ok().flatten();
            row_vals.push(val.map(|s| s.to_string()));
        }
        rows.push(row_vals);
    }

    Ok(DbQueryResult { columns, rows })
}

#[tauri::command]
pub fn db_save_connections(
    app: AppHandle,
    connections: Vec<DbConnection>,
) -> Result<(), String> {
    let path = connections_file_path(&app)?;
    let file = DbConnectionsFile { connections };
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("serialize error: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write error: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_load_connections(app: AppHandle) -> Result<Vec<DbConnection>, String> {
    let path = connections_file_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?;
    let file: DbConnectionsFile =
        serde_json::from_str(&raw).map_err(|e| format!("parse error: {e}"))?;
    Ok(file.connections)
}

#[tauri::command]
pub async fn db_list_sqlite_tables(file_path: String) -> Result<Vec<String>, String> {
    let url = format!("sqlite:{}", file_path);
    let mut conn = <sqlx::AnyConnection as SqlxConnection>::connect(&url)
        .await
        .map_err(|e| format!("open sqlite failed: {e}"))?;

    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .fetch_all(&mut conn)
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let mut names = Vec::new();
    for row in rows {
        if let Ok(name) = row.try_get::<String, _>(0) {
            names.push(name);
        }
    }

    let _ = conn.close().await;
    Ok(names)
}
