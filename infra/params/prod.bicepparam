// Production environment parameters (PLAN-016).
// Reference: az deployment group create --resource-group rg-c7ntax-prod --template-file infra/main.bicep --parameters infra/params/prod.bicepparam
//
// Secrets are read out of the deploying shell's environment (PLAN-030 §2.2), so a password never
// lives in this file or in the deployment history — and a run that is missing one now fails while
// the deployment is compiled instead of writing an empty signing key into Key Vault:
//   $env:POSTGRES_ADMIN_PASSWORD = '<generated>'
//   $env:JWT_SECRET_VALUE        = '<openssl rand -base64 48>'
//   $env:KUMO_MASTER_KEY_VALUE   = '<32 random bytes, base64>'
using '../main.bicep'

param environment = 'prod'
param uniqueSuffix = 'prod01'
param webOrigin = 'https://app.c7ntax.example.com'
param postgresSkuName = 'Standard_D2ds_v5'
param postgresSkuTier = 'GeneralPurpose'
param postgresHaMode = 'ZoneRedundant'
param postgresStorageGb = 128
param minReplicas = 2
param maxReplicas = 10
// The image the app starts with: deploy-env.ps1 passes the tag that is already running (or the
// public bootstrap image on the first run), so there is nothing to set here.
param imageTag = readEnvironmentVariable('IMAGE_TAG')
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
param jwtSecret = readEnvironmentVariable('JWT_SECRET_VALUE')
param kumoMasterKey = readEnvironmentVariable('KUMO_MASTER_KEY_VALUE')
// Flip to true only once Front Door is in front of this app (the ingress module from PLAN-016 §4).
// With it on and no Front Door, nothing can reach production at all (PLAN-030 §2.1).
param lockIngressToFrontDoor = false
