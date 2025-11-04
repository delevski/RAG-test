# Secrets Management Guide

## GitHub Actions Secrets

To set up secrets in GitHub Actions:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following secrets:

### Required Secrets:
- `OPENAI_API_KEY` - Your OpenAI API key (starts with `sk-`)

### Optional Secrets:
- `VERCEL_TOKEN` - If deploying to Vercel
- `VERCEL_ORG_ID` - If deploying to Vercel
- `VERCEL_PROJECT_ID` - If deploying to Vercel

## Local Development

Create `.env.local` file:
```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

## Docker Deployment

### Using Environment Variables:
```bash
export OPENAI_API_KEY=your_key_here
docker-compose up
```

### Using .env file:
Create `.env` file:
```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

Then run:
```bash
docker-compose up
```

## Kubernetes Deployment

### Create Secret:
```bash
kubectl create secret generic app-secrets \
  --from-literal=openai-api-key=your_key_here
```

### Or from file:
```bash
kubectl create secret generic app-secrets \
  --from-file=openai-api-key=./secrets/openai-api-key.txt
```

### Update Secret:
```bash
kubectl create secret generic app-secrets \
  --from-literal=openai-api-key=new_key_here \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | OpenAI API key for embeddings and chat |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model to use for chat |
| `NODE_ENV` | No | `development` | Node environment |
| `PORT` | No | `3000` | Server port |

