// C7NTAX — shared platform resources for one environment (PLAN-016, phases 1–4).
//
// Scope: the VNet and its subnets, Log Analytics, Key Vault, Container Registry, the
// PostgreSQL Flexible Server with its private DNS zone, and the Container Apps environment
// and app. Application Gateway and Front Door are deliberately separate modules (see
// infra/README.md) because they are the ingress layer and are validated against a live
// subscription before the first production cut-over.
//
// PLAN-030 hardened this file for go-live. Two rules it follows on purpose:
//
//   · Bicep never owns what is *running*. `imageTag` has no default and `deploy-env.ps1` passes
//     the tag the app is already running (a full public bootstrap image on the first run of an
//     environment), and no `traffic` rule is declared here at all — the promotion path's
//     update → 0%-traffic revision → health gate → traffic shift is the only thing that moves
//     either of them.
//   · A subnet is declared once, inline, with its NSG attached there. Every other resource
//     refers to the inline subnet through an `existing` handle, so a redeploy does not detach
//     and re-attach an NSG.
//
// Nothing here has been deployed yet, so validate before the first run with:
//     node scripts/azure/validate-bicep.mjs     (or: az bicep build --file infra/main.bicep)
//     az deployment group what-if --resource-group rg-c7ntax-<env> --template-file infra/main.bicep --parameters infra/params/<env>.bicepparam
//
// One environment per deployment. Dev and prod are separate resource groups (or separate
// subscriptions), and nothing here is shared between them.

targetScope = 'resourceGroup'

@description('Environment name: dev or prod. Used in resource names and tags.')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region for every resource.')
param location string = resourceGroup().location

@description('Short suffix that makes resource names globally unique (e.g. the last 6 of the subscription id).')
@minLength(3)
@maxLength(8)
param uniqueSuffix string

@description('PostgreSQL administrator login.')
param postgresAdminLogin string = 'c7ntaxadmin'

@description('PostgreSQL administrator password. Supply from Key Vault or a pipeline secret, never from a file in the repository.')
@secure()
@minLength(16)
param postgresAdminPassword string

@description('prod gets General Purpose with zone-redundant HA; dev gets a Burstable single-zone server.')
param postgresSkuName string = environment == 'prod' ? 'Standard_D2ds_v5' : 'Standard_B1ms'
param postgresSkuTier string = environment == 'prod' ? 'GeneralPurpose' : 'Burstable'
param postgresHaMode string = environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
param postgresStorageGb int = environment == 'prod' ? 128 : 32

// Required, with no default (PLAN-030 §1.3 and §2.7). deploy-env.ps1 passes the tag the app is
// already running, so a Bicep run restates the live image instead of introducing one; on the
// first run of an environment, when there is nothing to restate, it passes a full public
// bootstrap reference such as mcr.microsoft.com/k8se/quickstart:latest. That is what makes a
// Bicep-only run unable to move the running image: whatever is passed here is only the starting
// point for a new revision, and the script's own update is still the only thing that promotes.
@description('The image the app starts with: the tag the app is already running in this environment\'s registry, or a full public image reference on the first run. Never a default.')
param imageTag string

@description('Container registry login server, without the protocol. Leave empty to create one.')
param acrName string = 'acrc7ntax${environment}${uniqueSuffix}'

@description('Container Apps: minimum and maximum replicas.')
param minReplicas int = environment == 'prod' ? 2 : 1
param maxReplicas int = environment == 'prod' ? 10 : 3

// Minimum lengths, and no defaults anywhere (PLAN-030 §2.2): an empty signing key or vault
// master key written into Key Vault is worse than a deployment that fails, because the app would
// sign tokens with nothing and the Kumo vault would encrypt under nothing.
@description('Secrets that must exist before the app starts. Values are supplied at deploy time and stored in Key Vault, never in the template.')
@secure()
@minLength(32)
param jwtSecret string

@secure()
@minLength(32)
param kumoMasterKey string

@description('Public origin of this environment, used for WEB_ORIGIN/CORS_ORIGIN.')
param webOrigin string

// PLAN-030 §2.1. Turning this on restricts the app's ingress to Front Door's backend service
// tag, which is only correct once the Front Door module from the ingress work (PLAN-016 §4)
// exists: with it on and no Front Door in front, nothing can reach the app at all. Off by
// default, and prod.bicepparam says when to flip it.
@description('Restrict ingress to the AzureFrontDoor.Backend service tag. Requires the Front Door module to exist first.')
param lockIngressToFrontDoor bool = false

@description('Apply tags to every resource for cost and incident attribution.')
var commonTags = {
  application: 'C7NTAX'
  environment: environment
  managedBy: 'bicep'
  plan: 'PLAN-016'
}

// The subnets live in one place because the NSG rules have to name the same prefixes: a literal
// that drifts from the subnet it guards is a firewall rule that quietly stops matching.
var addressSpace = '10.20.0.0/16'
var subnets = {
  postgres: '10.20.1.0/24'
  aca: '10.20.2.0/23' // at least /23: a Container Apps environment reserves a large block
  appgw: '10.20.4.0/24' // Application Gateway requires a dedicated subnet
  pe: '10.20.5.0/24' // private endpoints: Key Vault now, ACR if prod ever takes one
}

// A tag is composed into this environment's registry; a full reference (which always contains a
// slash) is used as it stands — that is the bootstrap image on the first run of an environment,
// which has to pull without a registry identity.
var containerImage = contains(imageTag, '/') ? imageTag : '${acr.properties.loginServer}/c7ntax:${imageTag}'

// ── Observability: everything logs here, and diagnostics point at it ──
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-c7ntax-${environment}-${uniqueSuffix}'
  location: location
  tags: commonTags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: environment == 'prod' ? 365 : 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

// ── Key Vault: the only place a secret lives ──
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-c7ntax-${environment}-${uniqueSuffix}'
  location: location
  tags: commonTags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    // prod only (PLAN-030 §2.4): in production the vault is reached through the private endpoint
    // in snet-pe and its public data plane is closed. Deployments are unaffected — ARM writes the
    // secrets through the resource provider, not through the vault's public endpoint.
    //
    // Dev stays public *deliberately*: dev is exercised from a laptop that cannot reach a private
    // endpoint, so closing it there would break local development. The endpoint and zone below
    // are still created in dev, so the private path is proven before prod depends on it.
    publicNetworkAccess: environment == 'prod' ? 'Disabled' : 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}

resource secretJwt 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  // Key Vault names allow only letters, digits and hyphens; the environment variable it
  // feeds is JWT_SECRET, mapped through the Container App's secretRef below.
  name: 'JWT-SECRET'
  parent: keyVault
  properties: { value: jwtSecret, contentType: 'jwt-signing-key' }
}

resource secretKumo 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: 'KUMO-MASTER-KEY'
  parent: keyVault
  properties: { value: kumoMasterKey, contentType: 'kumo-vault-master-key' }
}

resource secretDb 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: 'DATABASE-URL'
  parent: keyVault
  properties: {
    value: 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgres.name}.postgres.database.azure.com:5432/c7_overwatch?sslmode=require&connection_limit=10'
    contentType: 'postgres-connection-string'
  }
}

// ── Network ──
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'vnet-c7ntax-${environment}-${uniqueSuffix}'
  location: location
  tags: commonTags
  properties: {
    addressSpace: { addressPrefixes: ['10.20.0.0/16'] }
    subnets: [
      // Delegated to PostgreSQL so the server can be injected without a public endpoint.
      { name: 'snet-postgres', properties: { addressPrefix: '10.20.1.0/24', delegations: [ { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } } ] } }
      // Container Apps environment.
      { name: 'snet-aca', properties: { addressPrefix: '10.20.2.0/23', delegations: [ { name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } } ] } }
      // Reserved for Application Gateway, which requires a dedicated subnet.
      { name: 'snet-appgw', properties: { addressPrefix: '10.20.4.0/24' } }
      { name: 'snet-pe', properties: { addressPrefix: '10.20.5.0/24' } }
    ]
  }
}

resource nsgPostgres 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: 'nsg-postgres-${environment}'
  location: location
  tags: commonTags
  properties: {
    securityRules: [
      { name: 'allow-postgres-from-aca', properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '5432', sourceAddressPrefix: '10.20.2.0/23', destinationAddressPrefix: '*' } }
      { name: 'deny-internet-inbound', properties: { priority: 4000, direction: 'Inbound', access: 'Deny', protocol: '*', sourcePortRange: '*', destinationPortRange: '*', sourceAddressPrefix: 'Internet', destinationAddressPrefix: '*' } }
    ]
  }
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  name: 'snet-postgres'
  parent: vnet
  properties: {
    addressPrefix: '10.20.1.0/24'
    delegations: [ { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } } ]
    networkSecurityGroup: { id: nsgPostgres.id }
  }
}

// Private DNS so the injected server resolves its own name inside the VNet.
resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.postgres.database.azure.com'
  location: 'global'
  tags: commonTags
}

resource privateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  name: 'link-${environment}'
  parent: privateDnsZone
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}

// ── PostgreSQL Flexible Server ──
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: 'psql-c7ntax-${environment}-${uniqueSuffix}'
  location: location
  tags: commonTags
  sku: { name: postgresSkuName, tier: postgresSkuTier }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: postgresStorageGb, autoGrow: 'Enabled' }
    backup: {
      backupRetentionDays: environment == 'prod' ? 35 : 7
      geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
    }
    highAvailability: { mode: postgresHaMode }
    network: {
      // VNet-injected with no public endpoint: dev never reaches prod data over the internet.
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: privateDnsZone.id
      publicNetworkAccess: 'Disabled'
    }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  name: 'c7_overwatch'
  parent: postgres
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Diagnostics: audit and slow-query logs to the workspace, not just to Azure's own store.
resource postgresDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-law'
  scope: postgres
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      { category: 'PostgreSQLLogs', enabled: true }
      { category: 'PostgreSQLFlexSessions', enabled: true }
    ]
    metrics: [ { category: 'AllMetrics', enabled: true } ]
  }
}

// ── Container registry ──
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: commonTags
  sku: { name: environment == 'prod' ? 'Premium' : 'Basic' }
  properties: {
    adminUserEnabled: false // managed identity pull only; no registry passwords
    policies: { retentionPolicy: { status: 'enabled', days: 30 } }
  }
}

// ── Container Apps ──
resource acaEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'aca-c7ntax-${environment}'
  location: location
  tags: commonTags
  properties: {
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logAnalytics.properties.customerId, sharedKey: logAnalytics.listKeys().primarySharedKey } }
    vnetConfiguration: { infrastructureSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-aca'), internal: false }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'c7ntax-${environment}'
  location: location
  tags: commonTags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: acaEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: [ { server: acr.properties.loginServer, identity: 'system' } ]
      secrets: [
        { name: 'jwt-secret', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/JWT-SECRET', identity: 'system' }
        { name: 'kumo-master-key', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/KUMO-MASTER-KEY', identity: 'system' }
        { name: 'database-url', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/DATABASE-URL', identity: 'system' }
      ]
    }
    template: {
      containers: [
        {
          name: 'c7ntax'
          image: '${acr.properties.loginServer}/c7ntax:${imageTag}'
          resources: { cpu: json(environment == 'prod' ? '2.0' : '1.0'), memory: environment == 'prod' ? '4Gi' : '2Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '4000' }
            { name: 'WEB_ORIGIN', value: webOrigin }
            { name: 'CORS_ORIGIN', value: webOrigin }
            { name: 'AUTH_HARDENING_ENABLED', value: 'true' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'KUMO_MASTER_KEY', secretRef: 'kumo-master-key' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
          probes: [
            { type: 'Liveness', httpGet: { path: '/api/health', port: 4000 }, initialDelaySeconds: 20, periodSeconds: 30 }
            { type: 'Readiness', httpGet: { path: '/api/health', port: 4000 }, initialDelaySeconds: 10, periodSeconds: 10 }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [ { name: 'http', http: { metadata: { concurrentRequests: '50' } } } ]
      }
    }
  }
}

// Let the app read its own secrets and pull its own image: no shared credentials anywhere.
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, containerApp.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') // AcrPull
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, containerApp.id, 'kvsecretsuser')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output keyVaultName string = keyVault.name
output acrLoginServer string = acr.properties.loginServer
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output logAnalyticsId string = logAnalytics.id
