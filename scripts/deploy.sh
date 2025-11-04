#!/bin/bash

# Deployment script for Smart Research Assistant
# Usage: ./scripts/deploy.sh [environment]

set -e

ENVIRONMENT=${1:-production}
ENV_FILE=".env.${ENVIRONMENT}"

echo "🚀 Deploying Smart Research Assistant to ${ENVIRONMENT}..."

# Check if environment file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "⚠️  Warning: $ENV_FILE not found. Using environment variables."
fi

# Load environment variables if file exists
if [ -f "$ENV_FILE" ]; then
  export $(cat "$ENV_FILE" | grep -v '^#' | xargs)
fi

# Validate required secrets
if [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ Error: OPENAI_API_KEY is not set"
  exit 1
fi

echo "✅ Environment variables validated"

# Build and deploy based on environment
case $ENVIRONMENT in
  production)
    echo "📦 Building production image..."
    docker build -t smart-research-assistant:latest .
    
    echo "🚀 Starting production deployment..."
    docker-compose -f docker-compose.yml up -d
    
    echo "✅ Deployment complete!"
    echo "🌐 App should be available at http://localhost:3000"
    ;;
  k8s)
    echo "📦 Building image..."
    docker build -t smart-research-assistant:latest .
    
    echo "🔐 Creating Kubernetes secrets..."
    kubectl create secret generic app-secrets \
      --from-literal=openai-api-key="$OPENAI_API_KEY" \
      --dry-run=client -o yaml | kubectl apply -f -
    
    echo "🚀 Deploying to Kubernetes..."
    kubectl apply -f k8s/deployment.yaml
    
    echo "✅ Kubernetes deployment complete!"
    ;;
  *)
    echo "❌ Unknown environment: $ENVIRONMENT"
    echo "Usage: ./scripts/deploy.sh [production|k8s]"
    exit 1
    ;;
esac

