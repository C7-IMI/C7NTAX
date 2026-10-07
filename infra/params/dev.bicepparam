// Development environment parameters (PLAN-016).
// Reference: az deployment group create --resource-group rg-c7ntax-dev --template-file infra/main.bicep --parameters infra/params/dev.bicepparam
using '../main.bicep'

param environment = 'dev'
param uniqueSuffix = 'dev001'
param webOrigin = 'https://c7ntax-dev.example.com'
// Supply at deploy time from Key Vault or the pipeline secret store:
//   az deployment group create ... --parameters postgresAdminPassword=$env:PG_PASSWORD jwtSecret=$env:JWT_SECRET kumoMasterKey=$env:KUMO_MASTER_KEY
param postgresAdminPassword = ''
param jwtSecret = ''
param kumoMasterKey = ''
