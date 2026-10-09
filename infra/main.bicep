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

@description('prod gets General Purpose with HA; dev gets a Burstable single-zone server. SameZone halves the compute cost but survives no availability-zone failure — see PLAN-030 §8.5.')
param postgresSkuName string = environment == 'prod' ? 'Standard_D2ds_v5' : 'Standard_B1ms'
param postgresSkuTier string = environment == 'prod' ? 'GeneralPurpose' : 'Burstable'
param postgresHaMode string = environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
param postgresStorageGb int = environment == 'prod' ? 128 : 32

// Off in both environments, on the reviewer's instruction and for a reason worth stating: the
// application runs in exactly **one** region. A geo-redundant backup is the ability to restore into
// the paired region — where this template puts no compute, no Front Door origin and no vault, so
// there is nothing to restore *to* and the recovery would be a rebuild that only exists on paper.
// It is the second half of a disaster plan whose first half has not been written. Turn it on the day
// a second region is real; the switch is one word here.
//
// (verify) Azure documents geo-redundant backup for Flexible Server as settable at *creation*, so a
// server built without it may not be able to gain it later without a restore. The operator should
// confirm that against the subscription before relying on "we can always turn it on".
@description('Geo-redundant Postgres backups. Disabled by default: single-region deployment, nothing to fail over to (PLAN-030 §9).')
@allowed(['Enabled', 'Disabled'])
param postgresGeoRedundantBackup string = 'Disabled'

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

// Reads of the vault's secrets into Log Analytics (PLAN-030 §2.6). With enableRbacAuthorization
// there is no access policy to inspect, so this audit trail is the only record of who read what.
resource keyVaultDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-law'
  scope: keyVault
  properties: {
    workspaceId: logAnalytics.id
    logs: [ { category: 'AuditEvent', enabled: true } ]
    metrics: [ { category: 'AllMetrics', enabled: true } ]
  }
}

// Every subnet is declared here and nowhere else, with its NSG attached here where it has one
// (PLAN-030 §1.5). A subnet declared twice — once inline, once as a child resource — makes every
// redeploy detach and re-attach its NSG, and can fail with AnotherOperationInProgress.
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'vnet-c7ntax-${environment}-${uniqueSuffix}'
  location: location
  tags: commonTags
  properties: {
    addressSpace: { addressPrefixes: [ addressSpace ] }
    subnets: [
      // Delegated to PostgreSQL so the server can be injected without a public endpoint.
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: subnets.postgres
          delegations: [ { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } } ]
          networkSecurityGroup: { id: nsgPostgres.id }
        }
      }
      // Container Apps environment, delegated to Microsoft.App. The environment declares a
      // Consumption workload profile (see acaEnv), which is what the current model requires: a
      // consumption-only environment would have to sit on an undelegated subnet (PLAN-030 §1.1).
      {
        name: 'snet-aca'
        properties: {
          addressPrefix: subnets.aca
          delegations: [ { name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } } ]
        }
      }
      // Reserved for Application Gateway, which requires a dedicated subnet.
      { name: 'snet-appgw', properties: { addressPrefix: subnets.appgw } }
      // Private endpoints. No NSG here in this change (PLAN-030 §2.5): adding one to a subnet
      // that already carries traffic is a separate, riskier change.
      { name: 'snet-pe', properties: { addressPrefix: subnets.pe } }
    ]
  }
}

// Reference handles onto the inline subnets above. `existing` keeps them out of the deployment,
// so nothing in this file puts a second PUT on a subnet (PLAN-030 §1.5). They resolve to
// compile-time resource ids, which means the resources using them declare their VNet dependency
// explicitly — see postgres and keyVaultPrivateEndpoint.
resource snetPostgres 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
  parent: vnet
  name: 'snet-postgres'
}

resource snetAca 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
  parent: vnet
  name: 'snet-aca'
}

resource snetPe 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
  parent: vnet
  name: 'snet-pe'
}

// The Postgres subnet's NSG (PLAN-030 §2.5). The default AllowVnetInBound rule (65000) admits
// every subnet in the VNet, which is why the original "allow from ACA" rule restricted nothing:
// the deny at 4000 is what gives the two allow rules below any meaning.
resource nsgPostgres 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: 'nsg-postgres-${environment}'
  location: location
  tags: commonTags
  properties: {
    securityRules: [
      {
        name: 'allow-postgres-from-aca'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '5432'
          sourceAddressPrefix: subnets.aca
          destinationAddressPrefix: '*'
        }
      }
      {
        // Replication between the primary and its standby stays inside this subnet.
        name: 'allow-postgres-internal'
        properties: {
          priority: 200
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: subnets.postgres
          destinationAddressPrefix: subnets.postgres
        }
      }
      {
        // Everything else arriving over the VNet is dropped before the implicit
        // AllowVnetInBound at 65000 can admit it.
        name: 'deny-vnet-inbound'
        properties: {
          priority: 4000
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: 'VirtualNetwork'
          destinationAddressPrefix: '*'
        }
      }
      {
        // Kept explicit even though the implicit DenyAllInBound (65500) already covers it.
        name: 'deny-internet-inbound'
        properties: {
          priority: 4100
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: 'Internet'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

// Private DNS so the injected server resolves its own name inside the VNet.
//
// DO NOT rename this zone (PLAN-030 §1.7 — a deliberate departure from the plan, which proposed
// c7ntax-<env>.postgres.database.azure.com to avoid a collision with future private endpoints):
// a VNet-injected flexible server only auto-registers its A record in the zone whose name matches
// its own *.postgres.database.azure.com namespace, so renaming it risks a server that resolves
// nowhere. The collision the plan wanted to avoid is avoided instead by giving Key Vault — and
// ACR, if prod ever takes a private endpoint — their own privatelink.vaultcore.azure.net /
// privatelink.azurecr.io zones, so nothing else ever needs this one.
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

// ── Key Vault private endpoint (PLAN-030 §2.4) ──
// The vault holds the Kumo master key, so in prod its public data plane is closed and this is
// the only way in. It exists in dev too, where public access stays on: that proves the private
// path (including the zone group wiring, which is the part that usually goes wrong) before prod
// depends on it, and it costs a private endpoint.
resource keyVaultDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: commonTags
}

resource keyVaultDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  name: 'link-${environment}'
  parent: keyVaultDnsZone
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-kv-c7ntax-${environment}'
  location: location
  tags: commonTags
  properties: {
    subnet: { id: snetPe.id }
    privateLinkServiceConnections: [
      {
        name: 'vault'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: [ 'vault' ]
        }
      }
    ]
  }
}

resource keyVaultPrivateDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  name: 'default'
  parent: keyVaultPrivateEndpoint
  properties: {
    privateDnsZoneConfigs: [
      { name: 'vault', properties: { privateDnsZoneId: keyVaultDnsZone.id } }
    ]
  }
}

// ── PostgreSQL Flexible Server ──
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
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
      geoRedundantBackup: postgresGeoRedundantBackup
    }
    highAvailability: { mode: postgresHaMode }
    network: {
      // VNet-injected with no public endpoint: dev never reaches prod data over the internet.
      delegatedSubnetResourceId: snetPostgres.id
      privateDnsZoneArmResourceId: privateDnsZone.id
      publicNetworkAccess: 'Disabled'
    }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
    // Zone redundancy is expressed by highAvailability.mode above: ServerProperties has no
    // zoneRedundant property on this API version (2024-08-01).
  }
  // snet-postgres is an `existing` handle onto a subnet declared inline in the VNet, so the VNet
  // ordering comes with it; what has to be explicit is that the server is not created before its
  // DNS zone is linked to the VNet, or Azure has nowhere to register the server's A record
  // (PLAN-030 §1.6).
  dependsOn: [
    privateDnsLink
  ]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  name: 'c7_overwatch'
  parent: postgres
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Server parameters (PLAN-030 §2.6). pgaudit is what makes the Postgres diagnostic setting below
// mean "audit": without it the server logs slow queries and not who changed the schema.
// pg_stat_statements stays in the list because it is part of Azure's default and dropping it
// would remove query statistics as a side effect of turning auditing on.
resource postgresPgauditLibrary 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  name: 'shared_preload_libraries'
  parent: postgres
  properties: { value: 'pg_stat_statements,pgaudit', source: 'user-override' }
}

resource postgresPgauditLog 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  name: 'pgaudit.log'
  parent: postgres
  properties: { value: 'ddl,role', source: 'user-override' }
}

resource postgresPgauditExtension 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  name: 'azure.extensions'
  parent: postgres
  properties: { value: 'pgaudit', source: 'user-override' }
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
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: commonTags
  sku: { name: environment == 'prod' ? 'Premium' : 'Basic' }
  properties: {
    adminUserEnabled: false // managed identity pull only; no registry passwords
    // prod only (PLAN-030 §1.4): the retention policy is a Premium feature and dev's registry is
    // Basic, so applying it there is rejected by the resource provider.
    policies: environment == 'prod' ? { retentionPolicy: { status: 'enabled', days: 30 } } : null
  }
}

// Who signed in and who pushed or pulled an image, into Log Analytics (PLAN-030 §2.6). These are
// the ACR category names as the resource provider spells them.
resource acrDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-law'
  scope: acr
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      { category: 'ContainerRegistryLoginEvents', enabled: true }
      { category: 'ContainerRegistryRepositoryEvents', enabled: true }
    ]
    metrics: [ { category: 'AllMetrics', enabled: true } ]
  }
}

// ── Container Apps ──
resource acaEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'aca-c7ntax-${environment}'
  location: location
  tags: commonTags
  properties: {
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logAnalytics.properties.customerId, sharedKey: logAnalytics.listKeys().primarySharedKey } }
    // A workload profile is what the current model requires (PLAN-030 §1.1). Without it the
    // environment is a *consumption-only* environment, which the resource provider only accepts
    // on an undelegated subnet — and snet-aca is delegated to Microsoft.App/environments.
    workloadProfiles: [ { name: 'Consumption', workloadProfileType: 'Consumption' } ]
    // prod only (PLAN-030 §2.11): the database underneath is zone-redundant, so the environment
    // that serves it should be too. Zone redundancy needs a subnet of at least /23 — snet-aca is
    // 10.20.2.0/23, so nothing had to be resized.
    zoneRedundant: environment == 'prod'
    vnetConfiguration: { infrastructureSubnetId: snetAca.id, internal: false }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'c7ntax-${environment}'
  location: location
  tags: commonTags
  // User-assigned, and only user-assigned (PLAN-030 §1.2): its AcrPull and Key Vault Secrets User
  // grants are created before the app is, so the first revision can pull its image and resolve
  // its three secret references. A system-assigned identity cannot do that — its grants can only
  // be created once the app exists, which is a race the first revision loses. Nothing else in
  // this package uses a system-assigned identity, so none is requested.
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: acaEnv.id
    configuration: {
      // Multiple, so a Bicep run cannot flip back the mode deploy-env.ps1 sets: in Single mode
      // `az containerapp update` replaces the serving revision immediately, which is exactly the
      // 0%-traffic health gate the script needs to keep (PLAN-030 §1.3).
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        allowInsecure: false
        // There is deliberately no `traffic` block here (PLAN-030 §1.3). `latestRevision: true`
        // hands a brand-new revision 100% of the traffic the moment it is created, before the
        // health gate has looked at it, and every Bicep run re-applies that. Traffic is owned by
        // the promotion path (deploy-env.ps1 and the workflow), which pins a named revision after
        // the gate passes. Declaring nothing here is what makes a Bicep-only run unable to change
        // what is serving.
        //
        // The origin restriction is off by default (PLAN-030 §2.1) because it is only correct
        // once the Front Door module exists: see lockIngressToFrontDoor. The rule shape is the
        // one this API version has — a match on the service tag, with `action: 'Allow'`. Anything
        // that does not match is meant to be refused; the first deployment with the switch on
        // confirms that from outside (infra/README.md, ingress checklist).
        ipSecurityRestrictions: lockIngressToFrontDoor ? [
          {
            name: 'allow-front-door'
            description: 'Only Front Door may reach the origin directly. Requires the Front Door module (PLAN-016 §4) to exist first.'
            action: 'Allow'
            ipAddressRange: 'AzureFrontDoor.Backend'
          }
        ] : null
      }
      registries: [ { server: acr.properties.loginServer, identity: appIdentity.id } ]
      secrets: [
        { name: 'jwt-secret', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/JWT-SECRET', identity: appIdentity.id }
        { name: 'kumo-master-key', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/KUMO-MASTER-KEY', identity: appIdentity.id }
        { name: 'database-url', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/DATABASE-URL', identity: appIdentity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'c7ntax'
          image: containerImage
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
  // Everything the first revision needs has to exist before it starts (PLAN-030 §1.2): both
  // grants, and the three secrets its `secretRef`s point at — Container Apps resolves a Key Vault
  // reference when the revision starts, and a reference to a secret that is not there yet is a
  // revision that cannot start.
  dependsOn: [
    acrPullRole
    kvSecretsUserRole
    secretJwt
    secretKumo
    secretDb
  ]
}

// Let the app read its own secrets and pull its own image: no shared credentials anywhere.
// The grants belong to a user-assigned identity, which exists before the app does (PLAN-030 §1.2).
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-c7ntax-${environment}-${uniqueSuffix}'
  location: location
  tags: commonTags
}

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Seeded from the identity, not the app: the app depends on this assignment, so seeding it from
  // the app would make the two depend on each other.
  name: guid(acr.id, appIdentity.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') // AcrPull
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appIdentity.id, 'kvsecretsuser')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output keyVaultName string = keyVault.name
output acrLoginServer string = acr.properties.loginServer
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output logAnalyticsId string = logAnalytics.id
