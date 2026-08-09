import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Azure AD / Entra ID SSO integration adapter.
 * 
 * Handles SAML 2.0 and OpenID Connect authentication federation
 * so C7NTAX users can sign in with their Microsoft work accounts.
 * 
 * SAML Configuration:
 *   - entityId: The C7NTAX SP entity ID (e.g. "https://c7ntax.com/saml")
 *   - acsUrl: Assertion Consumer Service URL
 *   - metadataUrl: Azure AD federation metadata URL
 *   - certificate: X.509 signing certificate (from Azure AD)
 *   - loginUrl: Azure AD login URL for IdP-initiated flow
 *   - logoutUrl: Azure AD logout URL
 * 
 * OIDC Configuration:
 *   - clientId: Application (client) ID from Azure AD
 *   - clientSecret: Client secret for confidential clients
 *   - tenantId: Directory (tenant) ID
 *   - redirectUri: C7NTAX callback URL
 *   - authority: OIDC authority URL
 *   - scopes: Space-separated OIDC scopes
 * 
 * Supported features:
 *   - Just-In-Time (JIT) user provisioning
 *   - Group claim mapping to C7NTAX roles
 *   - MFA enforcement via Azure AD Conditional Access
 */
export class AzureADSSOAdapter implements IIntegrationAdapter {
  readonly kind = "azure_ad_sso" as const;

  // ── SAML Helpers ─────────────────────────────────────────────────

  /**
   * Generate the Azure AD SAML metadata URL from tenant info.
   * Federation metadata: https://login.microsoftonline.com/{tenantId}/federationmetadata/2007-06/federationmetadata.xml
   */
  getSamlMetadataUrl(cfg: IntegrationConfig): string {
    const tenantId = cfg.credentials.tenantId || "common";
    return `https://login.microsoftonline.com/${tenantId}/federationmetadata/2007-06/federationmetadata.xml`;
  }

  /**
   * Build the SAML IdP-initiated login URL.
   */
  getSamlLoginUrl(cfg: IntegrationConfig): string {
    const tenantId = cfg.credentials.tenantId || "common";
    const entityId = encodeURIComponent(
      (cfg.settings?.entityId as string) || "https://c7ntax.com/saml"
    );
    const acsUrl = encodeURIComponent(
      (cfg.settings?.acsUrl as string) || "https://c7ntax.com/api/sso/saml/acs"
    );
    return `https://login.microsoftonline.com/${tenantId}/saml2?SAMLRequest=&RelayState=&SigAlg=&Signature=&client-request-id=&PartnerSpId=${entityId}&AssertionConsumerServiceUrl=${acsUrl}`;
  }

  /**
   * Build the OIDC authorization URL.
   */
  getOidcAuthUrl(cfg: IntegrationConfig): string {
    const tenantId = cfg.credentials.tenantId || "common";
    const clientId = cfg.credentials.clientId;
    const redirectUri = encodeURIComponent(
      (cfg.settings?.redirectUri as string) || "https://c7ntax.com/api/sso/oidc/callback"
    );
    const scopes = encodeURIComponent(
      (cfg.settings?.scopes as string) || "openid profile email User.Read"
    );
    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scopes}&response_mode=query`;
  }

  // ── User Provisioning Helpers ─────────────────────────────────────

  /**
   * Map Azure AD group claims to C7NTAX roles.
   * Users in the "C7NTAX-Admin" group get admin role, etc.
   */
  mapGroupToRole(groupName: string, cfg: IntegrationConfig): string | null {
    const mapping = (cfg.settings?.groupRoleMapping as Record<string, string>) || {
      "C7NTAX-Admin": "admin",
      "C7NTAX-Technician": "technician",
      "C7NTAX-Manager": "manager",
      "C7NTAX-Billing": "billing_admin",
      "C7NTAX-Client": "client",
    };
    return mapping[groupName] || null;
  }

  /**
   * Determine if a user should be auto-provisioned (JIT).
   */
  shouldAutoProvision(cfg: IntegrationConfig): boolean {
    return (cfg.settings?.jitProvisioning as boolean) !== false;
  }

  // ── IIntegrationAdapter ───────────────────────────────────────────

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      // Verify we can reach the Azure AD federation metadata endpoint
      const metadataUrl = this.getSamlMetadataUrl(cfg);
      const res = await fetch(metadataUrl, { headers: { Accept: "application/xml" } });
      return res.ok;
    } catch {
      return false;
    }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      kind: "azure_ad_sso",
      recordsProcessed: 0,
      errors: [],
      syncedAt: new Date(),
    };

    const protocol: string = (cfg.settings?.protocol as string) || "saml";

    // Return SSO configuration information
    (result as any).ssoConfig = {
      protocol,
      saml: protocol === "saml" ? {
        metadataUrl: this.getSamlMetadataUrl(cfg),
        loginUrl: this.getSamlLoginUrl(cfg),
        entityId: cfg.settings?.entityId || "https://c7ntax.com/saml",
        acsUrl: cfg.settings?.acsUrl || "https://c7ntax.com/api/sso/saml/acs",
        logoutUrl: cfg.settings?.logoutUrl || `https://login.microsoftonline.com/${cfg.credentials.tenantId || "common"}/saml2`,
        nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        attributeMapping: {
          email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
          firstName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
          lastName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
          displayName: "http://schemas.microsoft.com/identity/claims/displayname",
          groups: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
          objectId: "http://schemas.microsoft.com/identity/claims/objectidentifier",
          tenantId: "http://schemas.microsoft.com/identity/claims/tenantid",
        },
      } : undefined,
      oidc: protocol === "oidc" ? {
        authUrl: this.getOidcAuthUrl(cfg),
        authority: `https://login.microsoftonline.com/${cfg.credentials.tenantId || "common"}/v2.0`,
        scopes: (cfg.settings?.scopes as string) || "openid profile email User.Read",
        redirectUri: cfg.settings?.redirectUri || "https://c7ntax.com/api/sso/oidc/callback",
        clientId: cfg.credentials.clientId,
      } : undefined,
      groupRoleMapping: (cfg.settings?.groupRoleMapping as Record<string, string>) || {},
      jitProvisioning: this.shouldAutoProvision(cfg),
      mfaEnforced: (cfg.settings?.mfaEnforced as boolean) !== false,
    };

    result.recordsProcessed = 1; // SSO config counts as one record
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
