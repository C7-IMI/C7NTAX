import { useEffect } from "react";
import { Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { GlobalTooltip } from "./components/GlobalTooltip";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { TicketsPage, TicketDetailPage } from "./pages/Tickets";
import { BoardsPage } from "./pages/Boards";
import { ClientsPage } from "./pages/Clients";
import { ClientDetailPage } from "./pages/ClientDetail";
import { ContactsPage } from "./pages/Contacts";
import { BillingPage } from "./pages/Billing";
import { C7NCPage } from "./pages/C7NC";
import { ApiAccessPage } from "./pages/ApiAccess";
import { UsersPage } from "./pages/Users";
import { RolesPage } from "./pages/Roles";
import { KumoDashboardPage } from "./pages/Kumo";
import { KumoAssetsPage } from "./pages/KumoAssets";
import { KumoAssetDetailPage } from "./pages/KumoAssetDetail";
import { KumoPasswordsPage } from "./pages/KumoPasswords";
import { KumoDocumentsPage } from "./pages/KumoDocuments";
import { KumoConfigsPage } from "./pages/KumoConfigs";
import { KumoOrganizationsPage } from "./pages/KumoOrganizations";
import { KumoOrganizationDetailPage } from "./pages/KumoOrganizationDetail";
import { KumoDomainsPage } from "./pages/KumoDomains";
import { SettingsPage } from "./pages/Settings";
import { MyActivityPage } from "./pages/MyActivity";
import { MFASetupPage } from "./pages/MFASetup";
import { OpportunitiesPage } from "./pages/Opportunities";
import { ProjectsPage } from "./pages/Projects";
import { AssetsPage } from "./pages/Assets";
import { AssetDetailPage } from "./pages/AssetDetail";
import { KnowledgeBasePage } from "./pages/KnowledgeBase";
import { AuditLogsSection, ServiceBoardsSection } from "./pages/Administration";
import { ConfigurationHub, ConfigurationSectionPage } from "./pages/Configuration";
import { SecurityPage } from "./pages/Security";
import { CustomerPortalSettingsPage } from "./pages/CustomerPortalSettings";
import { ChangelogPage } from "./pages/Changelog";
import { EmailStudioPage } from "./pages/EmailStudio";
import { EmailBrandPage } from "./pages/EmailBrand";
import { EmailLogPage } from "./pages/EmailLog";
import { ConsolePage } from "./pages/ConsolePage";
import { CalendarPage } from "./pages/Calendar";
import { PTOPage } from "./pages/PTO";
import { FinanceDashboardPage } from "./pages/FinanceDashboard";
import { SystemSettingsPage } from "./pages/SystemSettings";
import { InferenceSettingsPage } from "./pages/InferenceSettings";
import { ProcurementPage } from "./pages/Procurement";
import { ReportsPage, ReviewsPage } from "./pages/Reports";
import { CustomReportsPage } from "./pages/CustomReports";
import { ReportDesignerPage } from "./pages/ReportDesigner";
import { SectionLanding, SECTION_DESCRIPTIONS } from "./pages/SectionLanding";
import { NotFoundPage } from "./pages/NotFound";
import { DeveloperHubPage } from "./pages/Developer";
import { DeveloperPurgePage } from "./pages/DeveloperPurge";
import { DeveloperDeploymentPage } from "./pages/DeveloperDeployment";
import { DeveloperDangerPage } from "./pages/DeveloperDanger";
import { RequireDeveloper } from "./components/developer/RequireDeveloper";
import { ProductCatalogPage } from "./pages/ProductCatalog";
import { OutlookAddInPage } from "./pages/OutlookAddIn";
import { C7NCFlexpointPage } from "./pages/C7NCFlexpoint";
import { NAV_TREE } from "./components/Layout";
import { LoadingScreen } from "./components/LoadingScreen";
import { HomePage } from "./pages/HomePage";
import { ServiceAlertsPage } from "./pages/ServiceAlerts";
import { ServiceAlertsSettingsPage } from "./pages/ServiceAlertsSettings";
import { QuotesPage } from "./pages/Quotes";
import { MonitorsPage } from "./pages/Monitors";
import { WebhooksPage } from "./pages/Webhooks";
import { SingleSignOnPage } from "./pages/SingleSignOn";
import { AiActionsPage } from "./pages/AiActions";
import { AssistantPage } from "./pages/Assistant";import { HelpPage } from "./pages/Help";
import { HelpGettingStarted, HelpFaq, HelpConfiguration, HelpIndex, HelpWalkthrough } from "./pages/HelpDoc";
import { UI_KUMO_ORGS } from "./lib/uiFlags";
import { ChecklistsPage } from "./pages/Checklists";
import { ChecklistDetailPage } from "./pages/ChecklistDetail";
import { ChangePasswordForm } from "./components/users/ChangePasswordForm";
import { PortalApp } from "./pages/portal/PortalApp";

/**
 * Held in front of the whole app while an administrator's reset is outstanding:
 * the API refuses every other route until the password is changed, so there is
 * nothing useful to show behind it.
 */
function PasswordChangeGate() {
  const { user, markPasswordChanged, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-900 p-4">
      <ChangePasswordForm
        firstName={user?.firstName}
        email={user?.email}
        onChanged={markPasswordChanged}
        onSignOut={logout}
      />
    </div>
  );
}

function ProtectedRoutes() {
  const navigate = useNavigate();

  // Backlog item 12 — global keyboard shortcuts (skip when typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // Never hijack typing: inputs, selects and rich-text editors (contenteditable) are all fields.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "t" || e.key === "T") navigate("/tickets");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <PasswordChangeGate />;
  return (
    <Layout>
      <DesktopNavBridge />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/boards" element={<BoardsPage />} />
        <Route path="/service-alerts" element={<ServiceAlertsPage />} />
        <Route path="/service-alerts/monitors" element={<MonitorsPage />} />
        <Route path="/admin/webhooks" element={<WebhooksPage />} />
        <Route path="/admin/sso" element={<SingleSignOnPage />} />
        {/* The Email Studio: every message this instance sends, with the templates behind them. */}
        <Route path="/admin/email" element={<EmailStudioPage />} />
        <Route path="/admin/email/brand" element={<EmailBrandPage />} />
        <Route path="/admin/email/log" element={<EmailLogPage />} />
        <Route path="/ai-actions" element={<AiActionsPage />} />
        {/* The console as a page: the same component as the popup, plus a URL worth sharing. */}
        <Route path="/console" element={<ConsolePage />} />
        {/*
          The Developer section. Every route goes through the same gate, so the section's visibility is
          decided in one place — `developer:view` — rather than four times over in four pages. Someone
          without it gets the not-found screen: hidden, not refused.
        */}
        <Route path="/developer" element={<RequireDeveloper><DeveloperHubPage /></RequireDeveloper>} />
        <Route path="/developer/purge" element={<RequireDeveloper><DeveloperPurgePage /></RequireDeveloper>} />
        <Route path="/developer/deployment" element={<RequireDeveloper><DeveloperDeploymentPage /></RequireDeveloper>} />
        <Route path="/developer/danger" element={<RequireDeveloper><DeveloperDangerPage /></RequireDeveloper>} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/admin/service-alerts" element={<ServiceAlertsSettingsPage />} />
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
        <Route path="/reports/reviews" element={<ReviewsPage />} />
        <Route path="/reports/qbr" element={<ReviewsPage />} />
        <Route path="/reports/weekly-review" element={<ReviewsPage period="week" />} />
        <Route path="/reports/monthly-review" element={<ReviewsPage period="month" />} />
        <Route path="/reports/analytics" element={<ReportsPage tab="analytics" />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/custom" element={<CustomReportsPage />} />
        <Route path="/reports/custom/:id/design" element={<ReportDesignerPage />} />
        {/*
          C7NC — one section for everything that connects C7NTAX to something else. The tab is the
          path, so every tab can be linked to, survives a reload and comes back from the back button.
          `/cloudconnect` is the pre-merge address and redirects rather than 404s: bookmarks, Help
          links and whatever anybody has open in a tab keep working.
        */}
        <Route path="/c7nc" element={<C7NCPage />} />
        <Route path="/c7nc/services" element={<C7NCPage />} />
        <Route path="/c7nc/models" element={<C7NCPage />} />
        <Route path="/c7nc/email" element={<C7NCPage />} />
        <Route path="/c7nc/apps" element={<C7NCPage />} />
        <Route path="/cloudconnect" element={<Navigate to="/c7nc/services" replace />} />
        <Route path="/section/c7nc" element={<Navigate to="/c7nc" replace />} />
        <Route path="/admin/api" element={<ApiAccessPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/kumo" element={<KumoDashboardPage />} />
        {UI_KUMO_ORGS && <Route path="/kumo/organizations" element={<KumoOrganizationsPage />} />}
        {UI_KUMO_ORGS && <Route path="/kumo/organizations/:id" element={<KumoOrganizationDetailPage />} />}
        {UI_KUMO_ORGS && <Route path="/kumo/domains" element={<KumoDomainsPage />} />}
        <Route path="/kumo/assets/:id" element={<KumoAssetDetailPage />} />
        <Route path="/kumo/assets" element={<KumoAssetsPage />} />
        <Route path="/kumo/checklists/:id" element={<ChecklistDetailPage />} />
        <Route path="/kumo/checklists" element={<ChecklistsPage />} />
        <Route path="/kumo/passwords" element={<KumoPasswordsPage />} />
        <Route path="/kumo/documents" element={<KumoDocumentsPage />} />
        <Route path="/kumo/configs" element={<KumoConfigsPage />} />
        <Route path="/admin/logs" element={<AuditLogsSection />} />
        <Route path="/admin/boards" element={<ServiceBoardsSection />} />
        <Route path="/admin/products" element={<ProductCatalogPage />} />
        <Route path="/admin/system" element={<SystemSettingsPage />} />
        <Route path="/admin/configuration" element={<ConfigurationHub />} />
        <Route path="/admin/configuration/:sectionId" element={<ConfigurationSectionPage />} />
        <Route path="/admin/security" element={<SecurityPage />} />
        <Route path="/admin/portal" element={<CustomerPortalSettingsPage />} />
        {/* C7NC — the companion clients. Not under Administration: these are things a user
            installs on their own machine, and the page is offered to anyone who can sign in.
            FlexPoint sits here too (see the nav's own note): it is a service the business already
            runs, configured beside the clients that install against this one. */}
        <Route path="/c7nc/outlook-addin" element={<OutlookAddInPage />} />
        <Route path="/c7nc/flexpoint" element={<C7NCFlexpointPage />} />
        <Route path="/admin" element={<ConfigurationHub />} />
        <Route path="/admin/changelog" element={<ChangelogPage />} />
        <Route path="/billing/dashboard" element={<FinanceDashboardPage />} />
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/help/getting-started" element={<HelpGettingStarted />} />
        <Route path="/help/faq" element={<HelpFaq />} />
        <Route path="/help/configuration" element={<HelpConfiguration />} />
        <Route path="/help/index" element={<HelpIndex />} />
        <Route path="/help/walkthroughs/:slug" element={<HelpWalkthrough />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/pto" element={<PTOPage />} />
        <Route path="/settings/ai" element={<InferenceSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* Where the header's Recent menu sends "Show All": this person's own activity, at length.
            Reachable by anyone signed in — the page scopes itself to the caller, which is the whole
            reason it is separate from the audit trail at /admin/logs. */}
        <Route path="/activity" element={<MyActivityPage />} />
        <Route path="/mfa-setup" element={<MFASetupPage />} />
        {/* Section landing pages — shown when clicking parent section in collapsed sidebar */}
        <Route path="/section/:sectionId" element={<SectionLandingRoute />} />
        {/* Every path the application does not address lands here rather than in the shell with an
            empty main, which is what a stale bookmark or a renamed route used to leave behind. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}

function SectionLandingRoute() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const section = NAV_TREE.find(n => n.id === sectionId);
  if (!section) return <Navigate to="/" replace />;
  const children = section.children || [];
  const mapped = children.map(c => ({
    id: c.id,
    to: c.to || "/",
    icon: c.icon,
    label: c.label,
  }));
  return (
    <SectionLanding
      sectionId={sectionId!}
      sectionLabel={section.label}
      subSections={mapped}
      descriptions={SECTION_DESCRIPTIONS[sectionId || ""]}
    />
  );
}

/** Bridges the Electron desktop menu "navigate" IPC into the router, so the
 *  desktop app behaves exactly like the WebUI plus native menu shortcuts. */
function DesktopNavBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).c7Desktop?.onNavigate) {
      return (window as any).c7Desktop.onNavigate((path: string) => navigate(path));
    }
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <>
      <GlobalTooltip />
      <Routes>
        {/* The customer portal is its own audience: a Contact, not a staff User. It renders
            outside the staff auth provider so nothing here can fall back to a staff session,
            and a 401 in the portal can never bounce the tab to the staff sign-in page. */}
        <Route path="/portal/*" element={<PortalApp />} />
        <Route path="*" element={<StaffApp />} />
      </Routes>
    </>
  );
}

function StaffApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </AuthProvider>
  );
}
