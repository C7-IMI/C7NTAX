// Production environment parameters (PLAN-016).
// Reference: az deployment group create --resource-group rg-c7ntax-prod --template-file infra/main.bicep --parameters infra/params/prod.bicepparam
//
// Secrets are empty on purpose: they are supplied per deployment from the pipeline's
// secret store, so a password never lives in this file or in the deployment history.
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
param postgresAdminPassword = ''
param jwtSecret = ''
param kumoMasterKey = ''
