import * as cdk from 'aws-cdk-lib';
import { DefaultStackSynthesizer } from 'aws-cdk-lib/core';
import { MyStack } from './stack';

const app = new cdk.App();
new MyStack(app, 'WebRTCSignalingStack', {
  synthesizer: new DefaultStackSynthesizer({
    fileAssetsBucketName: 'cdk-hnb659fds-hand2-assets-169698630369-ap-northeast-1',
  }),
});
