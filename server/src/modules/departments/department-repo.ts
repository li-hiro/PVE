import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { DepartmentRecord } from '../../domain.js';

interface DepartmentRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  user_count?: number;
  guest_count?: number;
}

const mapDepartment = (row: DepartmentRow): DepartmentRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdAt: row.created_at,
  userCount: row.user_count,
  guestCount: row.guest_count,
});

export function listDepartments(db: Db): DepartmentRecord[] {
  const rows = allRows<DepartmentRow>(
    db,
    `SELECT d.*,
       (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS user_count,
       (SELECT COUNT(*) FROM guests g WHERE g.department_id = d.id AND g.template = 0) AS guest_count
     FROM departments d ORDER BY d.created_at ASC`,
  );
  return rows.map(mapDepartment);
}

export const getDepartment = (db: Db, id: string): DepartmentRecord | null => {
  const row = oneRow<DepartmentRow>(db, 'SELECT d.* FROM departments d WHERE d.id = ?', id);
  return row ? mapDepartment(row) : null;
};

export const departmentNameExists = (db: Db, name: string, excludeId?: string): boolean => {
  const row = excludeId
    ? oneRow<{ id: string }>(db, 'SELECT id FROM departments WHERE name = ? AND id <> ?', name, excludeId)
    : oneRow<{ id: string }>(db, 'SELECT id FROM departments WHERE name = ?', name);
  return Boolean(row);
};

export function insertDepartment(db: Db, id: string, name: string, description: string): void {
  runSql(
    db,
    'INSERT INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)',
    id,
    name,
    description,
    new Date().toISOString(),
  );
}

export function updateDepartment(db: Db, id: string, name?: string, description?: string): void {
  if (name !== undefined) runSql(db, 'UPDATE departments SET name = ? WHERE id = ?', name, id);
  if (description !== undefined) runSql(db, 'UPDATE departments SET description = ? WHERE id = ?', description, id);
}

export const deleteDepartment = (db: Db, id: string): void => {
  runSql(db, 'DELETE FROM departments WHERE id = ?', id);
};

export const countDepartmentReferences = (db: Db, id: string): { users: number; guests: number } => {
  const users = Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE department_id = ?', id)?.n) ?? 0);
  const guests = Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM guests WHERE department_id = ?', id)?.n) ?? 0);
  return { users, guests };
};
