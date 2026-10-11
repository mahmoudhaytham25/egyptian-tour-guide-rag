# Tour Guide RAG bootstrap — install docker, pull ECR images, compose up.
# Runs under `bash -xe` via cloud-init; config arrives as exported env vars
# (APP_DIR, REPO_URL, REPO_REF, APP_PORT, AWS_REGION, ECR_REGISTRY,
# ECR_*_REPO, IMAGE_TAG, APP_SECRET_ARN) injected ahead of this script by
# ComputeStack.
# Images are built in CI and pushed by the GitHub OIDC deploy role; this
# box only pulls them (its IAM role has ECR read-only + secret read).
set -uxo pipefail
exec > >(tee /var/log/tour-guide-bootstrap.log) 2>&1

# 2G swapfile — mongo + the Python model server on a small instance.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

dnf update -y
dnf install -y docker git

# Bound container log growth on the small root volume.
cat > /etc/docker/daemon.json <<'JSON'
{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
JSON

systemctl enable --now docker
usermod -aG docker ec2-user

# Compose v2 plugin (not packaged in AL2023 repos). Pinned — bump deliberately.
COMPOSE_VERSION='v2.40.3'
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Clone only for the compose file — images come from ECR.
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"
git checkout "$REPO_REF"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# Render .env from the Secrets Manager JSON. jwt_secret is generated;
# gemini_api_key / internal_api_token stay 'REPLACE_ME' until filled in
# (the model server only warns on a missing Gemini key at boot).
secret_json=$(aws secretsmanager get-secret-value \
  --secret-id "$APP_SECRET_ARN" --region "$AWS_REGION" \
  --query SecretString --output text)
eval "$(printf '%s' "$secret_json" | python3 -c '
import json, sys, shlex
d = json.load(sys.stdin)
for k in ("gemini_api_key", "internal_api_token", "jwt_secret"):
    print(f"{k.upper()}={shlex.quote(str(d.get(k, \"\")))}")
')"

cat > .env <<ENV
ECR_REGISTRY=${ECR_REGISTRY}
ECR_BACKEND_REPO=${ECR_BACKEND_REPO}
ECR_FRONTEND_REPO=${ECR_FRONTEND_REPO}
ECR_MODEL_SERVER_REPO=${ECR_MODEL_SERVER_REPO}
APP_PORT=${APP_PORT}
IMAGE_TAG=${IMAGE_TAG}
GEMINI_API_KEY=${GEMINI_API_KEY}
JWT_SECRET=${JWT_SECRET}
INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN}
ENV
chmod 600 .env

# First boot usually runs before any image exists — the deploy pipeline's
# SSM command does the real pull+up once builds land. Don't fail bootstrap.
docker compose -f docker-compose.prod.yml pull \
  || echo "ECR empty — the first deploy build will populate it"
docker compose -f docker-compose.prod.yml up -d \
  || echo "stack not up yet — the deploy pipeline brings it up"

echo "bootstrap done — app on :${APP_PORT}"
