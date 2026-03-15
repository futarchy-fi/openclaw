# Staging Environments Specification (T1572)

**Task:** T1572  
**Parent:** T603 (META-8)  
**Status:** Ready for implementation

## Overview

This document specifies the staging environment setup for the Futarchy Web Redo migration.

## Subdomain Mapping

| Production           | Staging                      | Purpose                  |
| -------------------- | ---------------------------- | ------------------------ |
| markets.futarchy.ai  | staging.markets.futarchy.ai  | Trading platform staging |
| fao.futarchy.ai      | staging.fao.futarchy.ai      | FAO automation staging   |
| townhall.futarchy.ai | staging.townhall.futarchy.ai | Governance staging       |
| app.futarchy.fi      | staging-app.futarchy.fi      | Legacy app staging       |

## Infrastructure Requirements

### Compute

- **Platform:** AWS ECS or Kubernetes (EKS)
- **Instance Type:** t3.medium (staging)
- **Auto-scaling:** Min 1, Max 3
- **Regions:** us-east-1 (primary), eu-west-1 (DR)

### Database

- **Type:** PostgreSQL 15 (RDS)
- **Staging Instance:** db.t3.medium
- **Migration:** From production snapshot (nightly refresh)
- **SSL:** Required for all connections

### Storage

- **S3 Buckets:**
  - `futarchy-staging-assets`
  - `futarchy-staging-logs`
  - `futarchy-staging-backups`

### Networking

- **VPC:** Isolated staging VPC
- **Security Groups:**
  - ALB: 443 inbound
  - ECS: Internal only
  - RDS: ECS-only ingress

## Deployment Pipeline

### GitHub Actions Workflow

```yaml
name: Deploy to Staging
on:
  push:
    branches: [develop]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to staging
        run: |
          aws ecs update-service --cluster futarchy-staging --service ${SERVICE_NAME} --force-new-deployment
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...@futarchy-staging.XXXX.us-east-1.rds.amazonaws.com

# Redis
REDIS_URL=redis://futarchy-staging.XXXX.cache.amazonaws.com:6379

# APIs
FUTARCHY_API_URL=https://staging-api.futarchy.ai
MARKETS_API_URL=https://staging.markets.futarchy.ai/api

# Feature Flags
ENABLE_SHADOW_TRAFFIC=true
ENABLE_NEW_UI=true
```

## SSL/TLS Configuration

### Certificate Management

- **Provider:** Let's Encrypt via cert-manager
- **Renewal:** Auto (30 days before expiry)
- **Wildcard:** `*.staging.futarchy.ai`

### DNS Records

```
staging.markets.futarchy.ai  A  ALB_DNS_NAME
staging.fao.futarchy.ai      A  ALB_DNS_NAME
*.staging.futarchy.ai        A  ALB_DNS_NAME
```

## Monitoring

### Metrics

- **CloudWatch:** ECS CPU/Memory, RDS connections
- **Datadog:** Application metrics, APM
- **Grafana:** Custom dashboards

### Alerts

- Error rate > 5% (P1)
- P99 latency > 3s (P2)
- Database connections > 80% (P2)

## Access Control

### VPN Required

- All staging environments require VPN access
- No public admin endpoints

### Authentication

- Basic Auth for non-production paths
- OAuth for user-facing flows (test realm)

## Data Refresh Schedule

| Source         | Target      | Schedule           |
| -------------- | ----------- | ------------------ |
| Production RDS | Staging RDS | Daily at 02:00 UTC |
| Production S3  | Staging S3  | Real-time sync     |

## Validation Checklist

- [ ] All subdomains resolve correctly
- [ ] SSL certificates valid
- [ ] Database migrations run successfully
- [ ] E2E tests pass against staging
- [ ] Monitoring dashboards accessible
- [ ] Rollback procedure tested

## Rollback Plan

1. **Database:** Nightly snapshots retained for 7 days
2. **Deployments:** `aws ecs update-service --task-definition PREVIOUS`
3. **DNS:** Instant flip via Route53 weighted routing

## Estimated Effort

- Infrastructure setup: 2 days
- CI/CD pipeline: 1 day
- Monitoring/alerting: 1 day
- Documentation: 0.5 day
- **Total:** 4.5 days

## Dependencies

- AWS account with appropriate IAM
- Domain ownership (futarchy.ai)
- SSL certificate provisioning access
- Terraform/CloudFormation state bucket
