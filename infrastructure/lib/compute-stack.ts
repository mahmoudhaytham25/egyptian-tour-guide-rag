import * as fs from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import type { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  name: string;
  repositories: {
    backend: ecr.IRepository;
    frontend: ecr.IRepository;
    modelServer: ecr.IRepository;
  };
  repoUrl: string;
  repoRef: string;
  appPort: number;
  imageTag: string;
  instanceType: string;
  rootVolumeGb: number;
  allowedAppCidrs: string[];
  sshCidr?: string;
  keyPairName?: string;
}

// The single box the whole app runs on. Dedicated VPC with only public
// subnets (no NAT gateways, no extra cost); the nginx frontend container is
// the only public surface — mongo, the model server and the backend stay
// inside the compose network.
export class ComputeStack extends cdk.Stack {
  public readonly instance: ec2.Instance;
  public readonly appSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);
    const { name } = props;

    // --- networking -------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0, // public subnets only — the box pulls via its IGW
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    const sg = new ec2.SecurityGroup(this, 'Sg', {
      vpc,
      securityGroupName: name,
      description: 'Egyptian Tour Guide RAG - public app port, optional SSH',
      allowAllOutbound: true,
    });
    for (const cidr of props.allowedAppCidrs) {
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(props.appPort), 'frontend (nginx) + proxied API');
    }
    if (props.sshCidr) {
      sg.addIngressRule(ec2.Peer.ipv4(props.sshCidr), ec2.Port.tcp(22), 'SSH');
    }

    // --- secrets ------------------------------------------------------------
    // One JSON secret the bootstrap renders into /opt/<app>/.env. jwt_secret
    // is generated; gemini_api_key and internal_api_token are placeholders —
    // fill them in the console or with `aws secretsmanager put-secret-value`
    // (see README). The plaintext never enters the template or CDK state.
    const appSecret = new secretsmanager.Secret(this, 'AppSecrets', {
      secretName: `${name}/app`,
      description: 'env vars for docker-compose.prod.yml (GEMINI_API_KEY / JWT_SECRET / INTERNAL_API_TOKEN)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          gemini_api_key: 'REPLACE_ME',
          internal_api_token: 'REPLACE_ME',
        }),
        generateStringKey: 'jwt_secret',
        excludePunctuation: true,
        passwordLength: 48,
      },
      // Demo infra: `cdk destroy` should leave nothing billing behind.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.appSecret = appSecret;

    // --- instance role ------------------------------------------------------
    // SSM for shell+deploy access without port 22, ECR pull scoped to the
    // three app repos (not account-wide read), Secrets Manager read for the
    // bootstrap .env render. No static keys on the box.
    const role = new iam.Role(this, 'InstanceRole', {
      roleName: `${name}-instance`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });
    // docker pull needs BatchCheckLayerAvailability + BatchGetImage +
    // GetDownloadUrlForLayer (all repo-scoped) plus GetAuthorizationToken,
    // which AWS only accepts on '*' — grantPull wires both halves.
    for (const repo of Object.values(props.repositories)) {
      repo.grantPull(role);
    }
    appSecret.grantRead(role);

    // --- instance -----------------------------------------------------------
    const instance = new ec2.Instance(this, 'Instance', {
      instanceName: name,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: sg,
      role,
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      keyPair: props.keyPairName
        ? ec2.KeyPair.fromKeyPairName(this, 'KeyPair', props.keyPairName)
        : undefined,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(props.rootVolumeGb, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      // Re-run bootstrap (fresh box, empty volumes) when the compose/env
      // inputs baked into user_data change.
      userDataCausesReplacement: true,
    });

    // IMDSv2 only; hop=1 keeps containers off IMDS entirely — nothing in a
    // container needs instance creds (ECR pulls happen host-side via the
    // docker daemon), so a compromised container can't reach them via SSRF.
    const cfnInstance = instance.node.defaultChild as ec2.CfnInstance;
    cfnInstance.metadataOptions = {
      httpTokens: 'required',
      httpEndpoint: 'enabled',
      httpPutResponseHopLimit: 1,
    };

    // --- user data ----------------------------------------------------------
    // Config is exported as env vars, then the static script runs unchanged —
    // no templating engine, the bash stays reviewable in assets/user_data.sh.
    const userData = ec2.UserData.forLinux();
    const ecrRegistry = `${this.account}.dkr.ecr.${this.region}.amazonaws.com`;
    userData.addCommands(
      `export APP_NAME='${name}'`,
      `export APP_DIR='/opt/${name}'`,
      `export REPO_URL='${props.repoUrl}'`,
      `export REPO_REF='${props.repoRef}'`,
      `export APP_PORT='${props.appPort}'`,
      `export AWS_REGION='${this.region}'`,
      `export ECR_REGISTRY='${ecrRegistry}'`,
      `export ECR_BACKEND_REPO='${props.repositories.backend.repositoryName}'`,
      `export ECR_FRONTEND_REPO='${props.repositories.frontend.repositoryName}'`,
      `export ECR_MODEL_SERVER_REPO='${props.repositories.modelServer.repositoryName}'`,
      `export IMAGE_TAG='${props.imageTag}'`,
      `export APP_SECRET_ARN='${appSecret.secretArn}'`,
      fs.readFileSync(new URL('../assets/user_data.sh', import.meta.url), 'utf8'),
    );
    instance.addUserData(userData.render());

    const eip = new ec2.CfnEIP(this, 'Eip', {
      instanceId: instance.instanceId,
      domain: 'vpc',
      tags: [{ key: 'Name', value: name }],
    });
    this.instance = instance;

    new cdk.CfnOutput(this, 'AppUrl', {
      description: 'Tour Guide frontend URL',
      value: `http://${eip.attrPublicIp}:${props.appPort}`,
    });
    new cdk.CfnOutput(this, 'PublicIp', { value: eip.attrPublicIp });
    new cdk.CfnOutput(this, 'InstanceId', {
      description: 'Instance the CodeBuild deploy redeploys via SSM',
      value: instance.instanceId,
    });
    new cdk.CfnOutput(this, 'SsmConnectCommand', {
      description: 'Shell into the box without SSH (needs the Session Manager plugin)',
      value: `aws ssm start-session --target ${instance.instanceId}`,
    });
    new cdk.CfnOutput(this, 'AppSecretArn', {
      description: 'Fill gemini_api_key + internal_api_token here before first deploy',
      value: appSecret.secretArn,
    });
  }
}
