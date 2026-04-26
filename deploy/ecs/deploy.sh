#!/usr/bin/env bash
# deploy/ecs/deploy.sh — Deploy or update the UARE ECS Fargate service.
#
# Usage:
#   REGION=us-east-1 ACCOUNT_ID=123456789012 CLUSTER=uare-prod ./deploy/ecs/deploy.sh
#
# Prerequisites:
#   - AWS CLI v2 configured with access to ECR, ECS, Secrets Manager
#   - Docker available for image build
#   - jq installed for JSON parsing
