# Deployment Guide

This guide covers deploying the Smart Research Assistant to various platforms.

## Quick Start

### Local Development
```bash
npm install
npm run dev
```

### Docker Deployment
```bash
# Set environment variables
export OPENAI_API_KEY=your_key_here

# Build and run
docker-compose up --build
```

### Kubernetes Deployment
```bash
# Create secret
kubectl create secret generic app-secrets \
  --from-literal=openai-api-key=your_key_here

# Deploy
kubectl apply -f k8s/deployment.yaml
```

## Environment Variables

### Required
- `OPENAI_API_KEY` - Your OpenAI API key

### Optional
- `OPENAI_MODEL` - Model to use (default: `gpt-4o-mini`)
- `PORT` - Server port (default: `3000`)
- `NODE_ENV` - Environment (default: `development`)

## Secrets Management

### GitHub Actions
Set secrets in repository settings:
- Settings → Secrets and variables → Actions → New repository secret

### Docker
```bash
# Option 1: Environment variable
export OPENAI_API_KEY=your_key_here
docker-compose up

# Option 2: .env file
echo "OPENAI_API_KEY=your_key_here" > .env
docker-compose up
```

### Kubernetes
```bash
# Create secret
kubectl create secret generic app-secrets \
  --from-literal=openai-api-key=your_key_here

# Update secret
kubectl create secret generic app-secrets \
  --from-literal=openai-api-key=new_key \
  --dry-run=client -o yaml | kubectl apply -f -

# View secret (base64 encoded)
kubectl get secret app-secrets -o yaml
```

## Platform-Specific Deployments

### Vercel
1. Connect repository to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy automatically on push

### Railway
1. Connect repository to Railway
2. Add `OPENAI_API_KEY` in Railway dashboard
3. Deploy automatically

### Render
1. Create new Web Service
2. Connect repository
3. Add environment variables
4. Set build command: `npm install && npm run build`
5. Set start command: `npm start`

## Health Check

The app includes a health check endpoint:
- `GET /api/health` - Returns status and timestamp

Use this for:
- Docker health checks
- Kubernetes liveness/readiness probes
- Load balancer health checks

## Storage

The app requires persistent storage for:
- `uploads/` - Uploaded files
- `.data/faiss/` - Vector store data

Ensure these directories are:
- Persistent (not lost on container restart)
- Accessible to the application
- Backed up regularly for production

## Monitoring

Recommended monitoring:
- Application logs
- OpenAI API usage/rate limits
- Storage usage
- Response times

## Security Notes

- Never commit `.env.local` or secrets to git
- Use environment variables or secret managers
- Rotate API keys regularly
- Use HTTPS in production
- Implement rate limiting for production

