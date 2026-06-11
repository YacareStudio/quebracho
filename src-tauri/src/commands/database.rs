use crate::models::{DbConnection, DbConnectionsFile, DbQueryResult};
use sqlx::{Column, Connection as SqlxConnection, Row};
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
        "mysql" => execute_mysql_query(conn, query).await,
        "postgresql" => execute_pg_query(conn, query).await,
        "sqlserver" => execute_sqlserver_query(conn, query).await,
        other => Err(format!("unsupported db type: {}", other)),
    }
}

/// Coerce a column value from a native driver row into a display string.
///
/// The sqlx `Any` driver fails on many real-world column types (e.g. MySQL
/// TINYINT), so server queries use the native drivers and stringify each cell
/// by trying a ladder of concrete Rust types — widest/most-specific first.
/// Integers are tried before `bool` so a MySQL TINYINT renders as 0/1 rather
/// than true/false. Returns `None` for SQL NULL or an unmappable type.
macro_rules! coerce_cell {
    ($row:expr, $i:expr, [$($int:ty),* $(,)?]) => {
        if let Ok(v) = $row.try_get::<Option<String>, _>($i) {
            v
        }
        $(else if let Ok(v) = $row.try_get::<Option<$int>, _>($i) {
            v.map(|x| x.to_string())
        })*
        else if let Ok(v) = $row.try_get::<Option<f64>, _>($i) {
            v.map(|x| x.to_string())
        } else if let Ok(v) = $row.try_get::<Option<f32>, _>($i) {
            v.map(|x| x.to_string())
        } else if let Ok(v) = $row.try_get::<Option<bool>, _>($i) {
            v.map(|x| x.to_string())
        } else if let Ok(v) = $row.try_get::<Option<sqlx::types::Decimal>, _>($i) {
            v.map(|x| x.to_string())
        } else if let Ok(v) =
            $row.try_get::<Option<sqlx::types::chrono::NaiveDateTime>, _>($i)
        {
            v.map(|x| x.to_string())
        } else if let Ok(v) =
            $row.try_get::<Option<sqlx::types::chrono::NaiveDate>, _>($i)
        {
            v.map(|x| x.to_string())
        } else if let Ok(v) =
            $row.try_get::<Option<sqlx::types::chrono::NaiveTime>, _>($i)
        {
            v.map(|x| x.to_string())
        } else if let Ok(v) = $row.try_get::<Option<
            sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>,
        >, _>($i)
        {
            v.map(|x| x.to_string())
        } else if let Ok(v) = $row.try_get::<Option<sqlx::types::Uuid>, _>($i) {
            v.map(|x| x.to_string())
        } else if let Ok(v) = $row.try_get::<Option<sqlx::types::JsonValue>, _>($i) {
            v.map(|x| x.to_string())
        } else if let Ok(v) = $row.try_get::<Option<Vec<u8>>, _>($i) {
            v.map(|b| String::from_utf8_lossy(&b).into_owned())
        } else {
            None
        }
    };
}

async fn execute_mysql_query(
    conn: DbConnection,
    query: String,
) -> Result<DbQueryResult, String> {
    let url = build_sqlx_url(&conn)?;
    let mut connection = <sqlx::mysql::MySqlConnection as SqlxConnection>::connect(&url)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;

    // User-authored SQL from the query editor; trusted by design.
    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
        .fetch_all(&mut connection)
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let columns: Vec<String> = rows
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();

    let mut result_rows = Vec::new();
    for row in &rows {
        let mut result_row = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            result_row.push(coerce_cell!(row, i, [i64, i32, i16, i8, u64, u32, u16, u8]));
        }
        result_rows.push(result_row);
    }

    let _ = connection.close().await;
    Ok(DbQueryResult {
        columns,
        rows: result_rows,
    })
}

async fn execute_pg_query(
    conn: DbConnection,
    query: String,
) -> Result<DbQueryResult, String> {
    let url = build_sqlx_url(&conn)?;
    let mut connection = <sqlx::postgres::PgConnection as SqlxConnection>::connect(&url)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;

    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
        .fetch_all(&mut connection)
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let columns: Vec<String> = rows
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();

    let mut result_rows = Vec::new();
    for row in &rows {
        let mut result_row = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            result_row.push(coerce_cell!(row, i, [i64, i32, i16, i8]));
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

    // User-authored SQL from the query editor; trusted by design.
    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
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

/// List user tables for a live server connection (MySQL/MariaDB, PostgreSQL).
/// SQLite uses [`db_list_sqlite_tables`] instead, since it connects by file.
#[tauri::command]
pub async fn db_list_tables(conn: DbConnection) -> Result<Vec<String>, String> {
    let query = match conn.db_type.as_str() {
        "mysql" => {
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' \
             ORDER BY table_name"
        }
        // Cast to text: `information_schema` identifier columns use Postgres'
        // internal `name` type, which the sqlx `Any` driver cannot decode.
        "postgresql" => {
            "SELECT table_name::text FROM information_schema.tables \
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
             ORDER BY table_name"
        }
        other => return Err(format!("unsupported db type for table listing: {other}")),
    };

    let url = build_sqlx_url(&conn)?;
    let mut connection = <sqlx::AnyConnection as SqlxConnection>::connect(&url)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;

    let rows = sqlx::query(query)
        .fetch_all(&mut connection)
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let mut names = Vec::new();
    for row in rows {
        if let Ok(name) = row.try_get::<String, _>(0) {
            names.push(name);
        } else if let Ok(Some(name)) = row.try_get::<Option<String>, _>(0) {
            names.push(name);
        }
    }

    let _ = connection.close().await;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies the sqlx 0.9 `Any` driver can open a Windows absolute path
    // (backslashes + drive letter) through the exact `sqlite:{path}` URL the
    // command builds, and list user tables.
    #[tokio::test]
    async fn test_list_sqlite_tables_absolute_path() {
        sqlx::any::install_default_drivers();

        let path = std::env::temp_dir().join("quebracho_sqlx_probe.db");
        let _ = std::fs::remove_file(&path);
        let path_str = path.to_string_lossy().to_string();

        // Create the fixture (mode=rwc allows creation).
        {
            let create_url = format!("sqlite:{path_str}?mode=rwc");
            let mut c = <sqlx::AnyConnection as SqlxConnection>::connect(&create_url)
                .await
                .expect("create connect");
            sqlx::query(sqlx::AssertSqlSafe(
                "CREATE TABLE foo (id INTEGER); CREATE TABLE bar (id INTEGER);".to_string(),
            ))
            .execute(&mut c)
            .await
            .expect("create tables");
            let _ = c.close().await;
        }

        // Re-open with the SAME format the command uses.
        let tables = db_list_sqlite_tables(path_str).await.expect("list tables");
        assert_eq!(tables, vec!["bar".to_string(), "foo".to_string()]);

        let _ = std::fs::remove_file(&path);
    }
}
