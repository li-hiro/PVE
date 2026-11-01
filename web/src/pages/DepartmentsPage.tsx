import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiQuery, errorMessage } from '../lib/use-api';
import { formatDate } from '../lib/format';
import type { DepartmentRecord } from '../lib/types';
import {
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
  PageHeader,
  StatCard,
} from '../components/common';

interface DepartmentForm {
  name: string;
  description: string;
}

const EMPTY: DepartmentForm = { name: '', description: '' };

/**
 * 部门管理：部门是配额与数据范围的锚点。
 * 删除前由后端校验是否仍有用户或资源引用，前端只负责收集名称与描述。
 */
export function DepartmentsPage() {
  const { can } = useAuth();
  const departments = useApiQuery<DepartmentRecord[]>('/departments');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRecord | null>(null);
  const [form, setForm] = useState<DepartmentForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (department: DepartmentRecord): void => {
    setEditing(department);
    setForm({ name: department.name, description: department.description });
    setError(null);
    setModalOpen(true);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/departments/${editing.id}`, {
          name: form.name.trim(),
          description: form.description.trim(),
        });
      } else {
        await api.post('/departments', {
          name: form.name.trim(),
          description: form.description.trim(),
        });
      }
      setModalOpen(false);
      departments.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (department: DepartmentRecord): Promise<void> => {
    if (!window.confirm(`确认删除部门 ${department.name}？部门下仍有用户或资源时将被拒绝。`)) return;
    try {
      await api.del(`/departments/${department.id}`);
      departments.reload();
    } catch (err) {
      window.alert(errorMessage(err));
    }
  };

  if (departments.loading && !departments.data) return <LoadingBlock label="正在加载部门…" />;
  if (departments.error) return <ErrorBlock message={departments.error} onRetry={departments.reload} />;

  const rows = departments.data ?? [];
  const userTotal = rows.reduce((sum, item) => sum + (item.userCount ?? 0), 0);
  const guestTotal = rows.reduce((sum, item) => sum + (item.guestCount ?? 0), 0);

  return (
    <div className="page">
      <PageHeader
        title="部门管理"
        description="部门决定用户的数据范围与配额继承关系；资源归属人所在部门即为审计归属。"
        actions={
          can('department.manage') ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              新建部门
            </button>
          ) : null
        }
      />

      <div className="stat-grid">
        <StatCard label="部门数量" value={rows.length} hint="组织结构根节点" tone="accent" />
        <StatCard label="部门成员" value={userTotal} hint="所有部门用户合计" tone="info" />
        <StatCard label="归属资源" value={guestTotal} hint="按部门归属统计" tone="success" />
        <StatCard
          label="空部门"
          value={rows.filter((item) => (item.userCount ?? 0) === 0).length}
          hint="尚无成员的部门"
          tone="warning"
        />
      </div>

      <Card title="部门列表" subtitle="部门管理员仅能看到与自身相关的组织信息">
        {rows.length === 0 ? (
          <EmptyState title="暂无部门" description="创建部门后即可按部门分配配额与用户。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>部门</th>
                  <th>描述</th>
                  <th>成员</th>
                  <th>资源</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((department) => (
                  <tr key={department.id}>
                    <td>
                      <strong>{department.name}</strong>
                      <div className="cell-sub mono">{department.id}</div>
                    </td>
                    <td>{department.description || '—'}</td>
                    <td>{department.userCount ?? 0}</td>
                    <td>{department.guestCount ?? 0}</td>
                    <td>{formatDate(department.createdAt)}</td>
                    <td>
                      {can('department.manage') ? (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-mini btn-ghost"
                            onClick={() => openEdit(department)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="btn btn-mini btn-danger"
                            onClick={() => void remove(department)}
                          >
                            删除
                          </button>
                        </div>
                      ) : (
                        <span className="cell-sub">只读</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? `编辑部门 · ${editing.name}` : '新建部门'}
        subtitle="部门名称唯一，变更会写入审计链"
        onClose={() => setModalOpen(false)}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button type="submit" form="department-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <form id="department-form" className="form" onSubmit={submit}>
          <label>
            部门名称
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              minLength={2}
              maxLength={64}
              required
            />
            <span className="field-hint">建议使用组织内的正式名称，便于审计报表聚合。</span>
          </label>
          <label>
            描述
            <input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              maxLength={200}
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
        </form>
      </Modal>
    </div>
  );
}
