import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface CiStackProps extends cdk.StackProps {
  name: string;
  githubRepo: string; // 'owner/repo' the OIDC trust policy is scoped to
  codebuildProjectArn: string;
}

// GitHub Actions OIDC — the deploy job authenticates via a short-lived role
// session; no AWS keys are stored in GitHub. The role is assumable only by
// workflows on the configured repo's main branch, and all it can do is kick
// off the deploy build (the heavy lifting lives inside CodeBuild).
export class CiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { name } = props;

    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });

    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: `${name}-github-deploy`,
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
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

    new cdk.CfnOutput(this, 'GithubDeployRoleArn', {
      description: 'Role CI assumes via OIDC — set as the AWS_DEPLOY_ROLE_ARN GitHub Actions secret',
      value: role.roleArn,
    });
  }
}
