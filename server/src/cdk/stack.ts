import * as path from "node:path";
import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const fn = new NodejsFunction(this, "Lambda", {
      functionName: "RTCSignalingLambda",
      entry: path.join(__dirname, "../server/lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
    });

    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    new CfnOutput(this, "EndpointOutput", { value: url.url });
  }
}
