import { resolve } from 'node:path';

export interface AlertThresholds {
  cpuPct: number;
  memPct: number;
  diskPct: number;
}

export interface AnomalyConfig {
  windowMinutes: number;
  destructiveBurst: number;
  failureBurst: number;
  denialBurst: number;
  loginFailureBurst: number;
  afterHoursStart: number;
  afterHoursEnd: number;
}

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  databasePath: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  encryptionKey: string;
  corsOrigins: string[];
  logLevel: string;
  syncEnabled: boolean;
  syncIntervalMs: number;
  metricsRetentionDays: number;
  demoMode: boolean;
  bootstrapAdminPassword: string;
  demoUserPassword: string;
  sessionTtlSec: number;
  consoleTtlSec: number;
  thresholds: AlertThresholds;
  anomaly: AnomalyConfig;
  webhookUrl: string | null;
  webhookTimeoutMs: number;
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

/**
 * 配置加载器：所有外部依赖均来自环境变量，便于容器化部署与测试注入。
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<AppConfig> = {},
): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const databasePath = env.DATABASE_PATH ?? './data/virtgate.db';
  const config: AppConfig = {
    nodeEnv,
    host: env.HOST ?? '0.0.0.0',
    port: toInt(env.PORT, 8080),
    databasePath:
      databasePath === ':memory:' ? databasePath : resolve(databasePath),
    jwtSecret: env.JWT_SECRET ?? 'virtgate-insecure-dev-secret',
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '8h',
    encryptionKey: env.ENCRYPTION_KEY ?? 'virtgate-insecure-dev-encryption-key',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    logLevel: env.LOG_LEVEL ?? 'info',
    syncEnabled: toBool(env.SYNC_ENABLED, true),
    syncIntervalMs: toInt(env.SYNC_INTERVAL_SEC, 30) * 1000,
    metricsRetentionDays: toInt(env.METRICS_RETENTION_DAYS, 7),
    demoMode: toBool(env.DEMO_MODE, true),
    bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD ?? 'Admin@12345',
    demoUserPassword: env.DEMO_USER_PASSWORD ?? 'Demo@12345',
    sessionTtlSec: toInt(env.SESSION_TTL_SEC, 8 * 3600),
    consoleTtlSec: toInt(env.CONSOLE_TTL_SEC, 300),
    thresholds: {
      cpuPct: toInt(env.ALERT_CPU_THRESHOLD, 85),
      memPct: toInt(env.ALERT_MEM_THRESHOLD, 90),
      diskPct: toInt(env.ALERT_DISK_THRESHOLD, 92),
    },
    anomaly: {
      windowMinutes: toInt(env.ANOMALY_WINDOW_MINUTES, 10),
      destructiveBurst: toInt(env.ANOMALY_DESTRUCTIVE_BURST, 3),
      failureBurst: toInt(env.ANOMALY_FAILURE_BURST, 5),
      denialBurst: toInt(env.ANOMALY_DENIAL_BURST, 3),
      loginFailureBurst: toInt(env.ANOMALY_LOGIN_FAILURE_BURST, 5),
      afterHoursStart: toInt(env.ANOMALY_AFTER_HOURS_START, 0),
      afterHoursEnd: toInt(env.ANOMALY_AFTER_HOURS_END, 6),
    },
    webhookUrl: env.ALERT_WEBHOOK_URL && env.ALERT_WEBHOOK_URL.length > 0 ? env.ALERT_WEBHOOK_URL : null,
    webhookTimeoutMs: toInt(env.ALERT_WEBHOOK_TIMEOUT_MS, 5000),
  };

  const merged: AppConfig = { ...config, ...overrides, thresholds: { ...config.thresholds, ...(overrides.thresholds ?? {}) }, anomaly: { ...config.anomaly, ...(overrides.anomaly ?? {}) } };

  if (merged.nodeEnv === 'production') {
    if (!env.JWT_SECRET) throw new Error('生产环境必须显式设置 JWT_SECRET');
    if (!env.ENCRYPTION_KEY) throw new Error('生产环境必须显式设置 ENCRYPTION_KEY');
  }
  return merged;
}
