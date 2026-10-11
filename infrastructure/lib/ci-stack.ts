import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface CiStackProps extends cdk.StackProps {
  name: string;
  githubRepo: string; // 'owner/repo' the OIDC trust policy is scoped to
  codebuildProjectArn: string;
  codebuildProjectName: string;
  // AWS allows only one 'token.actions.githubusercontent.com' OIDC provider
  // per account. If another CDK app / Terraform config already created one,
  // pass its ARN here to import it instead of failing on a duplicate.
  oidcProviderArn?: string;
}

// GitHub Actions OIDC — the deploy job authenticates via a short-lived role
// session; no AWS keys are stored in GitHub. The role is assumable only by
// workflows on the configured repo's main branch, and all it can do is kick
// off the deploy build (the heavy lifting lives inside CodeBuild).
export class CiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { name } = props;

    const provider = props.oidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'GithubOidc', props.oidcProviderArn)
      : new iam.OpenIdConnectProvider(this, 'GithubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: `${name}-github-deploy`,
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // Exact match — only workflows running on this repo's main branch
          // (pushes to main; the only ref the deploy job runs on).
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RunBuilds',
        actions: ['codebuild:StartBuild'],
        resources: [props.codebuildProjectArn],
      }),
    );

    // The Actions job polls the build to completion — build reads live under
    // a different resource type ('build/<project>:<uuid>'), not the project.
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadBuilds',
        actions: ['codebuild:BatchGetBuilds'],
        resources: [
          cdk.Arn.format(
            { service: 'codebuild', resource: 'build', resourceName: `${props.codebuildProjectName}:*` },
            this,
          ),
        ],
      }),
    );

    new cdk.CfnOutput(this, 'GithubDeployRoleArn', {
      description: 'Role CI assumes via OIDC — set as the AWS_DEPLOY_ROLE_ARN GitHub Actions secret',
      value: role.roleArn,
    });
  }
}
