# UARE Architecture

## Overview
UARE is structured as a modular backend that combines platform services with execution systems.

## Layers

### API Layer
- Express server
- route grouping by domain
- auth and middleware enforcement

### Platform Services
- identity and sessions
- billing and subscriptions
- organizations and roles

### Execution System
- job orchestration
- worker runtime
- CAD execution
- artifact generation and storage

### Operations
- health and readiness endpoints
- metrics and audit
- production verification scripts

## Execution flow
1. client sends request
2. API validates and authenticates
3. job or action is created
4. worker executes task if async
5. result stored and exposed via API

## Evolution path
Current: modular monolith
Future: extraction into platform services and execution services
