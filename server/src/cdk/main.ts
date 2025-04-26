import * as cdk from 'aws-cdk-lib';
import { MyStack } from './stack';
import { DefaultStackSynthesizer } from 'aws-cdk-lib/core';

const app = new cdk.App();
new MyStack(app, 'WebRTCSignalingStack', {
  synthesizer: new DefaultStackSynthesizer({
    fileAssetsBucketName: 'cdk-hnb659fds-hand2-assets-169698630369-ap-northeast-1',
  }),
});
