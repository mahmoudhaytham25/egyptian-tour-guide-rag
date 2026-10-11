import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

export interface DeployStackProps extends cdk.StackProps {
  name: string;
  repositories: {
    backend: ecr.IRepository;
    frontend: ecr.IRepository;
    modelServer: ecr.IRepository;
  };
  repoUrl: string;
  instance: ec2.IInstance;
}

// One parameterized build project. The GitHub Actions deploy job detects
// which service directories changed in a push and starts this build with
// CHANGED_SERVICES + IMAGE_TAG env overrides. The buildspec
// (assets/buildspec.deploy.yml) clones the repo, builds+pushes each changed
// image to ECR, then redeploys the EC2 box over SSM.
//
// Source is NO_SOURCE + self-clone — no GitHub OAuth/CodeConnections needed;
// the repo is public so the clone needs no credentials.
export class DeployStack extends cdk.Stack {
  public readonly project: codebuild.IProject;

  constructor(scope: Construct, id: string, props: DeployStackProps) {
    super(scope, id, props);
    const { name } = props;

    const project = new codebuild.Project(this, 'Project', {
      projectName: `${name}-build`,
      // No `source` prop → NO_SOURCE project: the buildspec self-clones the
      // repo, so no GitHub OAuth/CodeConnection is needed.
      // The buildspec is staged as an S3 asset — the file stays the reviewable source of
      // truth and the project role gets read access automatically.
      buildSpec: codebuild.BuildSpec.fromAsset(
        fileURLToPath(new URL('../assets/buildspec.deploy.yml', import.meta.url)),
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true, // docker build+push
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        REPO_URL: { value: props.repoUrl },
        APP_DIR: { value: `/opt/${name}` },
        ECR_REGISTRY: { value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com` },
        ECR_BACKEND_REPO: { value: props.repositories.backend.repositoryName },
        ECR_FRONTEND_REPO: { value: props.repositories.frontend.repositoryName },
        ECR_MODEL_SERVER_REPO: { value: props.repositories.modelServer.repositoryName },
        INSTANCE_ID: { value: props.instance.instanceId },
      },
      timeout: cdk.Duration.minutes(45), // the model-server image is heavy
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'Logs', {
            retention: logs.RetentionDays.TWO_WEEKS,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        },
      },
    });

    // ECR push (+ auth token) — scoped to the three app repos.
    for (const repo of Object.values(props.repositories)) {
      repo.grantPush(project.role!);
    }

    // SSM redeploy: run a shell script on the box, then poll the result.
    const instanceArn = cdk.Arn.format(
      { service: 'ec2', resource: 'instance', resourceName: props.instance.instanceId },
      this,
    );
    project.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'SendDeployCommand',
        actions: ['ssm:SendCommand'],
        resources: [
          instanceArn,
          cdk.Arn.format(
            { service: 'ssm', account: '', resource: 'document', resourceName: 'AWS-RunShellScript' },
            this,
          ),
        ],
      }),
    );
    project.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadCommandStatus',
        actions: ['ssm:GetCommandInvocation'],
        resources: [instanceArn],
      }),
    );

    this.project = project;

    new cdk.CfnOutput(this, 'ProjectName', {
      description: 'Build project name — set as the CODEBUILD_PROJECT GitHub Actions variable',
      value: project.projectName,
    });
  }
}
