import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { TicketsPage, TicketDetailPage } from "./pages/Tickets";
import { BoardsPage } from "./pages/Boards";
import { ClientsPage } from "./pages/Clients";
import { ClientDetailPage } from "./pages/ClientDetail";
import { ContactsPage } from "./pages/Contacts";
import { BillingPage } from "./pages/Billing";
import { CloudConnectPage } from "./pages/CloudConnect";
import { UsersPage } from "./pages/Users";
import { RolesPage } from "./pages/Roles";
import { KumoDashboardPage } from "./pages/Kumo";
import { KumoAssetsPage } from "./pages/KumoAssets";
import { KumoAssetDetailPage } from "./pages/KumoAssetDetail";
import { KumoPasswordsPage } from "./pages/KumoPasswords";
import { KumoDocumentsPage } from "./pages/KumoDocuments";
import { KumoConfigsPage } from "./pages/KumoConfigs";
import { SettingsPage } from "./pages/Settings";
import { MFASetupPage } from "./pages/MFASetup";
import { OpportunitiesPage } from "./pages/Opportunities";
import { ProjectsPage } from "./pages/Projects";
import { AssetsPage } from "./pages/Assets";
import { AssetDetailPage } from "./pages/AssetDetail";
import { KnowledgeBasePage } from "./pages/KnowledgeBase";
import { AdministrationPage, AdminLogsPage, AdminServiceBoardsPage } from "./pages/Administration";
import { ChangelogPage } from "./pages/Changelog";
import { CalendarPage } from "./pages/Calendar";
import { PTOPage } from "./pages/PTO";
import { FinanceDashboardPage } from "./pages/FinanceDashboard";
import { SystemSettingsPage } from "./pages/SystemSettings";
import { InferenceSettingsPage } from "./pages/InferenceSettings";
import { ProcurementPage } from "./pages/Procurement";
import { ReportsPage } from "./pages/Reports";
import { LoadingScreen } from "./components/LoadingScreen";

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/boards" element={<BoardsPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/assets/:id" element={<AssetDetailPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/procurement" element={<ProcurementPage />} />
        <Route path="/kb" element={<KnowledgeBasePage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/contacts" element={<ContactsPage />} />
        <Route path="/billing/agreements" element={<BillingPage tab="agreements" />} />
        <Route path="/billing/payments" element={<BillingPage tab="payments" />} />
        <Route path="/billing/time" element={<BillingPage tab="time" />} />
        <Route path="/billing/reports" element={<BillingPage tab="reports" />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/reports/standard" element={<ReportsPage tab="standard" />} />
        <Route path="/reports/analytics" element={<ReportsPage tab="analytics" />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/cloudconnect" element={<CloudConnectPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/kumo" element={<KumoDashboardPage />} />
        <Route path="/kumo/assets/:id" element={<KumoAssetDetailPage />} />
        <Route path="/kumo/assets" element={<KumoAssetsPage />} />
        <Route path="/kumo/passwords" element={<KumoPasswordsPage />} />
        <Route path="/kumo/documents" element={<KumoDocumentsPage />} />
        <Route path="/kumo/configs" element={<KumoConfigsPage />} />
        <Route path="/admin/logs" element={<AdminLogsPage />} />
        <Route path="/admin/boards" element={<AdminServiceBoardsPage />} />
        <Route path="/admin/system" element={<SystemSettingsPage />} />
        <Route path="/admin" element={<AdministrationPage />} />
        <Route path="/admin/changelog" element={<ChangelogPage />} />
        <Route path="/billing/dashboard" element={<FinanceDashboardPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/pto" element={<PTOPage />} />
        <Route path="/settings/ai" element={<InferenceSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/mfa-setup" element={<MFASetupPage />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </AuthProvider>
  );
}
