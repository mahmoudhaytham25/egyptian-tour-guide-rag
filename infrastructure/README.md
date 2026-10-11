# Infrastructure — Egyptian Tour Guide RAG on AWS

Minimal AWS CDK (TypeScript) app: **one EC2 instance** that pulls pre-built
images from **ECR** and runs `docker compose -f docker-compose.yml` (the
explicit `-f` keeps the committed `docker-compose.override.yml` dev
overlay from auto-merging on the box).
On every push to `main`, CI diffs the changed paths and triggers a
**CodeBuild** build that clones the repo, builds+pushes images for the
changed services (`backend/`, `frontend/`, `model-server/`), then redeploys
the box over SSM — no AWS keys stored anywhere (GitHub OIDC). The nginx
frontend is the only public surface (`:3000`); it proxies `/api` to the
backend, which talks to mongo and the Flask model server inside the compose
network.

```
infrastructure/
├── bin/app.ts            # all settings live here (repo, sizes, ports)
├── lib/
│   ├── ecr-stack.ts      # 3 image repos: backend / frontend / model-server
│   ├── compute-stack.ts  # VPC (public-only), SG, instance role, secret,
│   │                     # EC2 + EIP + user_data bootstrap
│   ├── deploy-stack.ts   # CodeBuild project (NO_SOURCE; buildspec asset)
│   └── ci-stack.ts       # GitHub OIDC provider + deploy trigger role
└── assets/
    ├── user_data.sh      # bootstrap: docker + clone + secret render + compose up
    └── buildspec.deploy.yml  # clone → docker build/push → SSM redeploy
```

`cdk deploy --all` resolves the dependency order automatically
(ecr → compute → deploy → ci). Stacks are environment-agnostic — `cdk synth`
works without credentials; cross-stack values pass through SSM parameters
(weak refs), so dropping a reference later can't deadlock exports.

## One-time setup

1. Install deps and bootstrap the account/region once (standard CDK
   requirement — the buildspec is staged as an S3 asset):
   ```bash
   cd infrastructure
   npm install
   npx cdk bootstrap --profile <your-aws-profile>
   ```
2. Deploy:
   ```bash
   npx cdk deploy --all --profile <your-aws-profile>
   ```
   (or `cdk deploy <stack>` one at a time in order:
   `…-ecr` → `…-compute` → `…-deploy` → `…-ci`)
3. Fill the Secrets Manager secret `<name>/app` (stack output
   `AppSecretArn`): set `gemini_api_key` and `internal_api_token` —
   `jwt_secret` is already generated. Any value works for the internal
   token; it just has to match what the backend sends.
   ```bash
   aws secretsmanager put-secret-value --profile <your-aws-profile> \
     --secret-id <AppSecretArn> \
     --secret-string '{"gemini_api_key":"...","internal_api_token":"...","jwt_secret":"<keep-generated>"}'
   ```
   Then re-run the bootstrap's env render by restarting the stack, or just
   edit `/opt/egyptian-tour-guide-rag-dev/.env` on the box directly.
4. Wire the outputs into GitHub (**Settings → Secrets and variables →
   Actions**):

   | Stack output (stack)                     | GitHub entry          | Kind     |
   |------------------------------------------|-----------------------|----------|
   | `GithubDeployRoleArn` (ci)               | `AWS_DEPLOY_ROLE_ARN` | secret   |
   | `ProjectName` (deploy)                   | `CODEBUILD_PROJECT`   | variable |
   | *(your region)*                          | `AWS_REGION`          | variable |

5. Push to `main` — the `deploy` CI job diffs the push and calls
   `codebuild start-build` with `CHANGED_SERVICES` + `IMAGE_TAG`, then
   waits on the build. The buildspec clones the repo at that SHA,
   builds+pushes each changed image (`<sha>` + `latest`), then sends an SSM
   command that `git pull`s the box, `compose pull && up -d`s it (the box's
   `.env` always tracks `:latest`, so only rebuilt services restart), and
   polls `http://localhost:<APP_PORT>/api/health` until the stack answers.

First boot: read `AppUrl` from the compute stack outputs, wait ~5 min, check
`/var/log/tour-guide-bootstrap.log` via `aws ssm start-session --target <id>`
(no SSH key needed; set `sshCidr` + `keyPairName` in `bin/app.ts` for port
22). On first boot ECR is still empty — the bootstrap skips `compose up`
gracefully and the first deploy build brings the stack up.

## Secrets

`JWT_SECRET` is generated into the Secrets Manager secret; `GEMINI_API_KEY`
and `INTERNAL_API_TOKEN` are placeholders you fill in. The instance reads
the secret at boot and renders `/opt/<app>/.env` (chmod 600) — plaintext
secrets never enter the template, CDK state, or user data.

## Deploying a new release

Just push to `main` — the `deploy` job handles it (and now fails the check
if the build or the health check fails). The deploy job is a no-op until
the three GitHub entries above exist (it skips cleanly). To pin a specific
commit on first boot instead of `latest`, set `imageTag` in `bin/app.ts` —
changing user data replaces the instance (fresh box, empty mongo/vector
volumes).

Manual deploys: trigger the `<name>-build` project in the CodeBuild console
with no overrides — it builds all three services off `main` and tags them
`:latest`. Override `CHANGED_SERVICES` / `IMAGE_TAG` / `GIT_REF` for a
partial or pinned build. Rollback: retag an older sha image as `latest` in
ECR (`aws ecr batch-get-image` + `put-image`), then run a manual build —
the redeploy pulls it.

## Cost note

t3.small + 30 GB gp3 + EIP + 3 ECR repos + 1 secret ≈ ~$20/mo (t3.small is
**not** free-tier eligible — t3.micro would be, but mongo + the Python
model server want the 2 GB). EIP is free while attached to a running
instance — **`cdk destroy --all` when done**; every resource is
`RemovalPolicy.DESTROY`, so nothing keeps billing afterwards (an
unattached EIP is the classic one to watch if you ever disassociate it by
hand).

Note: AWS allows only **one** `token.actions.githubusercontent.com` OIDC
provider per account. If another IaC project already created one, set
`githubOidcProviderArn` in `bin/app.ts` to import it instead of creating a
duplicate.
