#!/usr/bin/env node
// CDK app — Egyptian Tour Guide RAG on AWS.
//
// Four stacks, applied in dependency order by `cdk deploy --all`:
//   ecr     → 3 image repos (backend / frontend / model-server)
//   compute → VPC, SG, instance role, Secrets Manager secret, EC2 + EIP
//   deploy  → CodeBuild project (clone → build+push → SSM redeploy)
//   ci      → GitHub OIDC provider + role the Actions deploy job assumes
//
// Stacks are environment-agnostic: `cdk synth` needs no credentials, and
// `cdk deploy --all --profile <name>` lands them in whatever account/region
// the AWS CLI resolves. For a fixed target set `env` below or use
// CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION.

import * as cdk from 'aws-cdk-lib';
import { CiStack } from '../lib/ci-stack';
import { ComputeStack } from '../lib/compute-stack';
import { DeployStack } from '../lib/deploy-stack';
import { EcrStack } from '../lib/ecr-stack';

// --------------------------------------------------------------------------
// Your settings — edit these:
// --------------------------------------------------------------------------
const config = {
  project: 'egyptian-tour-guide-rag',
  envName: 'dev',

  githubRepo: 'mahmoudhaytham25/egyptian-tour-guide-rag',
  repoUrl: 'https://github.com/mahmoudhaytham25/egyptian-tour-guide-rag.git',
  repoRef: 'main',

  appPort: 3000, // nginx frontend — the only public port
  imageTag: 'latest', // tag deployed on first boot; CI owns it afterwards
  instanceType: 't3.small', // mongo + the Python model server want the 2 GB
  rootVolumeGb: 30,
  allowedAppCidrs: ['0.0.0.0/0'],
  sshCidr: undefined as string | undefined, // set e.g. '1.2.3.4/32' for port 22
  keyPairName: undefined as string | undefined, // EC2 key pair for SSH (SSM needs none)
};
// --------------------------------------------------------------------------

function main() {
  const app = new cdk.App();
  const name = `${config.project}-${config.envName}`;
  const stackProps = {
    // env: { account: '123456789012', region: 'us-east-1' }, // pin a target here
    tags: {
      Project: config.project,
      Environment: config.envName,
      ManagedBy: 'cdk',
    },
  };

  const ecr = new EcrStack(app, `${name}-ecr`, { ...stackProps, name });

  const compute = new ComputeStack(app, `${name}-compute`, {
    ...stackProps,
    name,
    repositories: {
      backend: ecr.backend,
      frontend: ecr.frontend,
      modelServer: ecr.modelServer,
    },
    repoUrl: config.repoUrl,
    repoRef: config.repoRef,
    appPort: config.appPort,
    imageTag: config.imageTag,
    instanceType: config.instanceType,
    rootVolumeGb: config.rootVolumeGb,
    allowedAppCidrs: config.allowedAppCidrs,
    sshCidr: config.sshCidr,
    keyPairName: config.keyPairName,
  });
  compute.addStackDependency(ecr);

  const deploy = new DeployStack(app, `${name}-deploy`, {
    ...stackProps,
    name,
    repositories: {
      backend: ecr.backend,
      frontend: ecr.frontend,
      modelServer: ecr.modelServer,
    },
    repoUrl: config.repoUrl,
    instance: compute.instance,
  });
  deploy.addStackDependency(compute);

  new CiStack(app, `${name}-ci`, {
    ...stackProps,
    name,
    githubRepo: config.githubRepo,
    codebuildProjectArn: deploy.project.projectArn,
  }).addStackDependency(deploy);

  app.synth();
}

main();
