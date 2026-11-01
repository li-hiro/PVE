import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RequirePermission } from './components/Guards';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { GuestsPage } from './pages/GuestsPage';
import { GuestCreatePage } from './pages/GuestCreatePage';
import { GuestDetailPage } from './pages/GuestDetailPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { QuotasPage } from './pages/QuotasPage';
import { AuditPage } from './pages/AuditPage';
import { AlertsPage } from './pages/AlertsPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { ClustersPage } from './pages/ClustersPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <RequirePermission permission="dashboard.read">
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="guests"
          element={
            <RequirePermission permission="guest.read">
              <GuestsPage />
            </RequirePermission>
          }
        />
        <Route
          path="guests/new"
          element={
            <RequirePermission permission="guest.create">
              <GuestCreatePage />
            </RequirePermission>
          }
        />
        <Route
          path="guests/:id"
          element={
            <RequirePermission permission="guest.read">
              <GuestDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="templates"
          element={
            <RequirePermission permission="template.read">
              <TemplatesPage />
            </RequirePermission>
          }
        />
        <Route
          path="quotas"
          element={
            <RequirePermission permission="quota.read">
              <QuotasPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit.read">
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route
          path="alerts"
          element={
            <RequirePermission permission="alert.read">
              <AlertsPage />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission permission="user.read">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="roles"
          element={
            <RequirePermission permission="role.read">
              <RolesPage />
            </RequirePermission>
          }
        />
        <Route
          path="departments"
          element={
            <RequirePermission permission="department.read">
              <DepartmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="clusters"
          element={
            <RequirePermission permission="cluster.read">
              <ClustersPage />
            </RequirePermission>
          }
        />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
