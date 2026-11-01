export type RoleScope = 'global' | 'department' | 'own';

export interface PermissionDefinition {
  key: string;
  label: string;
  group: string;
  description: string;
}

/**
 * 权限目录是前端权限矩阵与后端校验的唯一事实来源。
 */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { key: 'dashboard.read', label: '查看监控面板', group: '监控', description: '查看集群资源与告警概览' },
  { key: 'cluster.read', label: '查看集群', group: '集群', description: '查看已接入的 PVE 集群信息' },
  { key: 'cluster.manage', label: '管理集群', group: '集群', description: '接入、编辑、删除与同步集群' },
  { key: 'guest.read', label: '查看虚拟机', group: '资源', description: '查看授权范围内的虚拟机与容器' },
  { key: 'guest.create', label: '创建资源', group: '资源', description: '从模板克隆或新建虚拟机/容器' },
  { key: 'guest.power', label: '电源操作', group: '资源', description: '启动、停止、重启与重置资源' },
  { key: 'guest.config', label: '调整配置', group: '资源', description: '修改 CPU、内存等运行规格' },
  { key: 'guest.delete', label: '删除资源', group: '资源', description: '删除虚拟机或容器' },
  { key: 'guest.console', label: '控制台访问', group: '资源', description: '打开串口或 VNC 控制台会话' },
  { key: 'template.read', label: '查看模板', group: '模板', description: '查看可用于自助开通的模板' },
  { key: 'template.manage', label: '管理模板', group: '模板', description: '将资源标记为模板或取消模板' },
  { key: 'quota.read', label: '查看配额', group: '配额', description: '查看部门与用户的资源配额及用量' },
  { key: 'quota.manage', label: '管理配额', group: '配额', description: '调整部门与用户的配额上限' },
  { key: 'user.read', label: '查看用户', group: '组织', description: '查看授权范围内的用户' },
  { key: 'user.manage', label: '管理用户', group: '组织', description: '创建、编辑、停用用户与重置密码' },
  { key: 'role.read', label: '查看角色', group: '组织', description: '查看角色与权限矩阵' },
  { key: 'role.manage', label: '管理角色', group: '组织', description: '创建与调整自定义角色' },
  { key: 'department.read', label: '查看部门', group: '组织', description: '查看部门组织结构' },
  { key: 'department.manage', label: '管理部门', group: '组织', description: '创建与调整部门' },
  { key: 'audit.read', label: '查看审计', group: '审计', description: '检索操作日志与轨迹时间线' },
  { key: 'audit.export', label: '导出审计', group: '审计', description: '导出 CSV/JSON 合规审计报表' },
  { key: 'audit.verify', label: '校验审计链', group: '审计', description: '校验哈希链完整性' },
  { key: 'alert.read', label: '查看告警', group: '告警', description: '查看资源告警与异常行为告警' },
  { key: 'alert.manage', label: '处置告警', group: '告警', description: '确认与关闭告警' },
  { key: 'operation.read', label: '查看操作记录', group: '审计', description: '查看操作流水与执行结果' },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((item) => item.key);

export interface BuiltinRoleDefinition {
  id: string;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: string[];
}

export const BUILTIN_ROLES: BuiltinRoleDefinition[] = [
  {
    id: 'role-platform-admin',
    name: 'platform_admin',
    description: '平台管理员：全集群、全组织、全审计权限',
    scope: 'global',
    permissions: ['*'],
  },
  {
    id: 'role-dept-admin',
    name: 'dept_admin',
    description: '部门管理员：管理本部门资源、用户与配额查看',
    scope: 'department',
    permissions: [
      'dashboard.read',
      'cluster.read',
      'guest.read',
      'guest.create',
      'guest.power',
      'guest.config',
      'guest.delete',
      'guest.console',
      'template.read',
      'template.manage',
      'quota.read',
      'user.read',
      'user.manage',
      'role.read',
      'department.read',
      'audit.read',
      'audit.export',
      'alert.read',
      'alert.manage',
      'operation.read',
    ],
  },
  {
    id: 'role-operator',
    name: 'operator',
    description: '运维操作员：自助创建资源并执行日常运维操作',
    scope: 'department',
    permissions: [
      'dashboard.read',
      'cluster.read',
      'guest.read',
      'guest.create',
      'guest.power',
      'guest.config',
      'guest.console',
      'template.read',
      'quota.read',
      'audit.read',
      'alert.read',
      'operation.read',
    ],
  },
  {
    id: 'role-viewer',
    name: 'viewer',
    description: '只读成员：查看本部门资源、配额与审计摘要',
    scope: 'department',
    permissions: [
      'dashboard.read',
      'cluster.read',
      'guest.read',
      'template.read',
      'quota.read',
      'audit.read',
      'alert.read',
      'operation.read',
    ],
  },
  {
    id: 'role-auditor',
    name: 'auditor',
    description: '合规审计员：全组织审计检索、校验与导出',
    scope: 'global',
    permissions: [
      'dashboard.read',
      'cluster.read',
      'guest.read',
      'quota.read',
      'audit.read',
      'audit.export',
      'audit.verify',
      'alert.read',
      'operation.read',
      'role.read',
      'user.read',
      'department.read',
      'template.read',
    ],
  },
];

export const hasPermission = (permissions: string[], required: string): boolean =>
  permissions.includes('*') || permissions.includes(required);

export const isKnownPermission = (key: string): boolean =>
  ALL_PERMISSION_KEYS.includes(key);
