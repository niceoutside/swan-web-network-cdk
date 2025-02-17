import {
  CodeBuildStep,
  CodePipeline,
  CodePipelineSource,
} from "aws-cdk-lib/pipelines";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { accounts } from "../constants/accounts";
import { mainRegion } from "../constants/regions";
import { RootDomainPipelineStage } from "./root-stage";
import { DelegatedDomainPipelineStage } from "./application-stage";

// That is the dev-tools Github connection that you receive when authenticating your AWS account with Github.
const CDK_PIPELINE_SOURCE_CONNECTION =
  "arn:aws:codestar-connections:us-east-1:050205021871:connection/b2a2b81c-1426-4fbb-8fa0-282fc54b16d6";

// That is the sample repo guiding the Medium article
const cdkSourceInput = CodePipelineSource.connection(
  "niceoutside/swan-web-network-cdk",
  "main",
  {
    connectionArn: CDK_PIPELINE_SOURCE_CONNECTION,
  }
);

const applicationStages: {
  targetAccount: string; // this will be the account we're rolling out to
  stageName: "dev" | "prod"; // this is also going to be the subdomain => dev.domain.com
}[] = [
  {
    stageName: "dev",
    targetAccount: accounts.dev,
  },
  {
    stageName: "prod",
    targetAccount: accounts.prod,
  },
];

export class DNSPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pipeline = new CodePipeline(this, "Pipeline", {
      crossAccountKeys: true,
      pipelineName: "DNS-Pipeline",
      synth: new CodeBuildStep("SynthStep", {
        input: cdkSourceInput,
        installCommands: ["npm install -g aws-cdk"],
        commands: ["npm ci", "npm run build", "npx cdk synth"],
      }),
    });

    const rootDomain = new RootDomainPipelineStage(
      this,
      `root-${accounts.rootDomain}`,
      {
        env: {
          region: mainRegion,
          account: accounts.rootDomain,
        },
      }
    );

    // manually adding the "special" root domain stack as first stage in the pipeline
    pipeline.addStage(rootDomain);

    // for each of the application stages, add stage to the pipeline
    applicationStages.forEach((stage) => {
      const applicationDomain = new DelegatedDomainPipelineStage(
        this,
        `${stage.stageName}-${stage.targetAccount}`,
        {
          stage: stage.stageName,
          env: {
            region: mainRegion,
            account: stage.targetAccount,
          },
        }
      );

      const sanityCheck =
        applicationDomain.buildSanityCheckCodeBuild(cdkSourceInput);

      pipeline.addStage(applicationDomain).addPost(sanityCheck);
    });
  }
}
