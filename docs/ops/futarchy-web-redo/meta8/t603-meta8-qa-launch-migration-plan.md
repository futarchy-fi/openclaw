# META-8: QA, Launch, and Migration Program

**Task:** T603  
**Program:** Futarchy Web Redo (2026-02-26)  
**Goal:** Migrate from existing surfaces to new subdomains with minimal disruption.

## Overview

This document serves as the central orchestration plan for the Futarchy Web Redo migration program. The migration involves transitioning from `app.futarchy.fi` to new subdomains (`markets.futarchy.ai`, `fao.futarchy.ai`) with a comprehensive QA, staging, and phased rollout strategy.

## Sub-tasks

### Phase 1: Testing Infrastructure

#### T1562/T1570: Cross-App E2E Suite

- **Scope:** Wallet + data + transaction flows across Townhall, FAO, and Markets
- **Repos:** futarchy-web, FAO, interface
- **Status:** ⚠️ BLOCKED - Requires correct repo worktree (not OpenClaw repo)
- **Deliverable:** Playwright/Cypress test suite covering critical user journeys

#### T1571: Cross-Browser Matrix

- **Scope:** Chrome, Safari, Firefox, Mobile (iOS/Android)
- **Platforms:** Desktop + Mobile Web
- **Deliverable:** Browser compatibility matrix with automated testing

### Phase 2: Staging & Infrastructure

#### T1572: Staging Environments Per Subdomain

- **Scope:**
  - `staging.markets.futarchy.ai`
  - `staging.fao.futarchy.ai`
  - `staging.townhall.futarchy.ai`
- **Status:** ⚠️ BLOCKED - Requires operator/coder role for infrastructure
- **Deliverable:** Staging environments spec (see [staging-environments-spec.md](./staging-environments-spec.md))

#### T1573: Shadow Traffic Testing

- **Scope:** Dual-write validation, request mirroring
- **Goal:** Validate new infrastructure without user impact
- **Deliverable:** Shadow traffic configuration and validation scripts

### Phase 3: DNS & SSL

#### T1574: DNS/SSL Setup for FAO

- **Domain:** `fao.futarchy.ai`
- **Tasks:**
  - DNS A/AAAA records
  - SSL certificate provisioning (Let's Encrypt)
  - CDN configuration

#### T1575: DNS/SSL Setup for Markets

- **Domain:** `markets.futarchy.ai`
- **Tasks:**
  - DNS A/AAAA records
  - SSL certificate provisioning
  - Redirect from `app.futarchy.fi`

### Phase 4: Migration Strategy

#### T1576: Cutover Strategy

- **From:** `app.futarchy.fi`
- **To:** `markets.futarchy.ai`
- **Approach:** Blue-green with instant rollback capability
- **Deliverable:** Runbook with timing, checkpoints, and rollback procedures

#### T1577: Redirects & Deprecation

- **Scope:**
  - 301 redirects from old paths
  - Deprecation banner on legacy app
  - User communication timeline
- **Deliverable:** Redirect mapping and messaging plan

### Phase 5: Launch Preparation

#### T1578: User Migration Guide

- **Audience:** End users, power traders, API consumers
- **Contents:**
  - What's changing
  - Timeline
  - Action items for users
  - FAQ

#### T1579: Launch Readiness Review

- **Checklist:**
  - [ ] All E2E tests passing
  - [ ] Staging validation complete
  - [ ] DNS/SSL configured and tested
  - [ ] Runbook reviewed and approved
  - [ ] Monitoring dashboards ready
  - [ ] On-call rotation confirmed

### Phase 6: Execution & Post-Launch

#### T1580: Phased Rollout

- **Phase 1:** 1% traffic (canary)
- **Phase 2:** 10% traffic
- **Phase 3:** 50% traffic
- **Phase 4:** 100% traffic
- **Gates:** Error rate < 0.1%, latency p99 < 2s

#### T1581: Post-Launch Bug Bash

- **Window:** 48 hours post-launch
- **Scope:** Priority hotfixes only
- **Team:** On-call + dedicated hotfix squad

#### T1582: Retrospective & Next-Wave

- **Timeline:** 1 week post-launch
- **Deliverable:** Retrospective doc + prioritized backlog for v2

## Current Blockers

1. **Repo/Worktree Mismatch:** T603 was provisioned in OpenClaw repo instead of futarchy-fi workspace
2. **Role Requirements:** Infrastructure tasks need operator/coder role (DNS, SSL, staging deploys)
3. **Daemon Instability:** Task system under load (2483 tasks, 32 dispatchable), claim endpoints timing out

## Next Actions

1. [ ] Re-provision T603 in correct worktree (futarchy-fi multi-repo)
2. [ ] Spawn T1570-T1582 as child tasks with correct repo targeting
3. [ ] Assign infrastructure tasks to coder agent with operator capabilities
4. [ ] Stabilize task daemon (reduce cron fanout)

## Related Documents

- [Staging Environments Spec](./staging-environments-spec.md) (T1572)
- [Cutover Runbook](./cutover-runbook.md) (T1576 - pending)
- [User Migration Guide](./user-migration-guide.md) (T1578 - pending)
