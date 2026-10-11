import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import type { Construct } from 'constructs';

export interface EcrStackProps extends cdk.StackProps {
  name: string;
}

// One repo per buildable service. Mongo isn't here — it runs the public
// mongo:7 image straight off Docker Hub.
export class EcrStack extends cdk.Stack {
  public readonly backend: ecr.Repository;
  public readonly frontend: ecr.Repository;
  public readonly modelServer: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrStackProps) {
    super(scope, id, props);

    const makeRepo = (service: string) =>
      new ecr.Repository(this, `Repo-${service}`, {
        repositoryName: `${props.name}-${service}`,
        // 'latest' is retagged on every deploy.
        imageTagMutability: ecr.TagMutability.MUTABLE,
        imageScanOnPush: true,
        // Unbounded 'latest' history would grow forever — keep the 10 most
        // recent images.
        lifecycleRules: [{ maxImageCount: 10 }],
        // Demo infra: let `cdk destroy` remove a non-empty repo.
        emptyOnDelete: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    this.backend = makeRepo('backend');
    this.frontend = makeRepo('frontend');
    this.modelServer = makeRepo('model-server');

    new cdk.CfnOutput(this, 'Registry', {
      description: 'ECR registry — set as the ECR_REGISTRY GitHub Actions variable',
      value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
    });
    for (const [key, repo] of Object.entries({
      backend: this.backend,
      frontend: this.frontend,
      modelServer: this.modelServer,
    })) {
      new cdk.CfnOutput(this, `RepoName-${key}`, { value: repo.repositoryName });
    }
  }
}
