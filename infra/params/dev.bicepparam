// Development environment parameters (PLAN-016).
// Reference: az deployment group create --resource-group rg-c7ntax-dev --template-file infra/main.bicep --parameters infra/params/dev.bicepparam
using '../main.bicep'

param environment = 'dev'
param uniqueSuffix = 'dev001'
param webOrigin = 'https://c7ntax-dev.example.com'
// The image the app starts with: deploy-env.ps1 passes the tag that is already running (or the
// public bootstrap image on the first run), so there is nothing to set here.
param imageTag = readEnvironmentVariable('IMAGE_TAG')
// Secrets are read out of the deploying shell's environment (PLAN-030 §2.2). A run that is
// missing one now fails while the deployment is being compiled instead of writing an empty
// secret into Key Vault:
//   $env:POSTGRES_ADMIN_PASSWORD = '<generated>'
//   $env:JWT_SECRET_VALUE        = '<openssl rand -base64 48>'
//   $env:KUMO_MASTER_KEY_VALUE   = '<32 random bytes, base64>'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
param jwtSecret = readEnvironmentVariable('JWT_SECRET_VALUE')
param kumoMasterKey = readEnvironmentVariable('KUMO_MASTER_KEY_VALUE')
// Left off: the app has to be reachable while the ingress module is validated (PLAN-016 §4).
param lockIngressToFrontDoor = false
