import * as path from "node:path";
import { CfnOutput, Stack, RemovalPolicy, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
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

    // Clientsテーブル
    const clientsTable = new Table(this, "ClientsTable", {
      partitionKey: { name: "id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: "RTCSignalingClients",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Messagesテーブル
    const messagesTable = new Table(this, "MessagesTable", {
      partitionKey: { name: "to", type: AttributeType.STRING },
      sortKey: { name: "timestamp", type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: "RTCSignalingMessages",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Lambda関数にテーブルへのアクセス権限を付与
    clientsTable.grantReadWriteData(fn);
    messagesTable.grantReadWriteData(fn);

    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    new CfnOutput(this, "EndpointOutput", { value: url.url });
  }
}
