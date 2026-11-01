/**
 * 数据库结构定义。所有变更以幂等 DDL 形式追加，启动时自动执行。
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'department',
    permissions TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    department_id TEXT REFERENCES departments(id),
    role_id TEXT NOT NULL REFERENCES roles(id),
    status TEXT NOT NULL DEFAULT 'active',
    email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL DEFAULT 'pve',
    api_url TEXT NOT NULL,
    token_id TEXT NOT NULL DEFAULT '',
    token_secret_enc TEXT NOT NULL DEFAULT '',
    verify_tls INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown',
    version TEXT NOT NULL DEFAULT '',
    node_count INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_sync_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    vmid INTEGER NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    node TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    cores INTEGER NOT NULL DEFAULT 0,
    memory_mb INTEGER NOT NULL DEFAULT 0,
    disk_gb INTEGER NOT NULL DEFAULT 0,
    network_mbps INTEGER NOT NULL DEFAULT 0,
    template INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    uptime_sec INTEGER NOT NULL DEFAULT 0,
    last_seen_status TEXT NOT NULL DEFAULT '',
    last_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(cluster_id, vmid)
  )`,

  `CREATE TABLE IF NOT EXISTS quota_policies (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    cpu_cores INTEGER,
    memory_mb INTEGER,
    storage_gb INTEGER,
    network_mbps INTEGER,
    guest_limit INTEGER,
    updated_at TEXT NOT NULL,
    UNIQUE(scope_type, scope_id)
  )`,

  `CREATE TABLE IF NOT EXISTS quota_reservations (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    vmid INTEGER,
    cpu_cores INTEGER NOT NULL DEFAULT 0,
    memory_mb INTEGER NOT NULL DEFAULT 0,
    storage_gb INTEGER NOT NULL DEFAULT 0,
    network_mbps INTEGER NOT NULL DEFAULT 0,
    guest_count INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL DEFAULT '',
    actor_id TEXT,
    actor_name TEXT NOT NULL DEFAULT '',
    cluster_id TEXT NOT NULL DEFAULT '',
    vmid INTEGER,
    guest_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    message TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    ts TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'operation',
    rule TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    acked_at TEXT,
    acked_by TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id TEXT NOT NULL,
    node TEXT NOT NULL,
    cpu_pct REAL NOT NULL DEFAULT 0,
    mem_pct REAL NOT NULL DEFAULT 0,
    disk_pct REAL NOT NULL DEFAULT 0,
    guests_running INTEGER NOT NULL DEFAULT 0,
    guests_total INTEGER NOT NULL DEFAULT 0,
    captured_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS console_sessions (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    vmid INTEGER NOT NULL,
    node TEXT NOT NULL,
    guest_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    ticket_enc TEXT NOT NULL,
    ticket_user TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 0,
    upstream_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_guests_cluster ON guests(cluster_id, vmid)`,
  `CREATE INDEX IF NOT EXISTS idx_guests_owner ON guests(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guests_department ON guests(department_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_id, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target_type, target_id, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_operations_actor ON operations(actor_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_operations_cluster ON operations(cluster_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_cluster ON metrics(cluster_id, node, captured_at)`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_scope ON quota_reservations(scope_type, scope_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_console_actor ON console_sessions(actor_id, expires_at)`,
];
