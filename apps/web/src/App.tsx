import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { TicketsPage, TicketDetailPage } from "./pages/Tickets";
import { BoardsPage } from "./pages/Boards";
import { ClientsPage } from "./pages/Clients";
import { BillingPage } from "./pages/Billing";
import { IntegrationsPage } from "./pages/Integrations";
import { UsersPage } from "./pages/Users";
import { SettingsPage } from "./pages/Settings";
import { MFASetupPage } from "./pages/MFASetup";
import { OpportunitiesPage } from "./pages/Opportunities";
import { ProjectsPage } from "./pages/Projects";
import { AssetsPage } from "./pages/Assets";
import { KnowledgeBasePage } from "./pages/KnowledgeBase";
import { InferenceSettingsPage } from "./pages/InferenceSettings";

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen bg-navy-950"><div className="animate-spin h-8 w-8 border-2 border-cyber-400 border-t-transparent rounded-full" /></div>;
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
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/kb" element={<KnowledgeBasePage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/users" element={<UsersPage />} />
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
