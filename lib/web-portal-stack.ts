import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { Construct } from 'constructs';

export interface WebPortalStackProps extends cdk.StackProps {
  userApiUrl: string;
  companyApiUrl: string;
  productApiUrl: string;
}

export class WebPortalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebPortalStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'WebPortalBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        ignorePublicAcls: false,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'WebPortalOAI');
    bucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'WebPortalDistribution', {
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: bucket,
            originAccessIdentity,
          },
          behaviors: [{ isDefaultBehavior: true }],
        },
      ],
      errorConfigurations: [
        { errorCode: 403, responseCode: 200, responsePagePath: '/index.html' },
        { errorCode: 404, responseCode: 200, responsePagePath: '/index.html' },
      ],
      defaultRootObject: 'index.html',
    });

    new s3deploy.BucketDeployment(this, 'DeployWebPortal', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../web-portal/dist'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'WebPortalUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Web Portal CloudFront URL',
    });

    new cdk.CfnOutput(this, 'ApiConfig', {
      value: JSON.stringify({
        USER_API_URL: props.userApiUrl,
        COMPANY_API_URL: props.companyApiUrl,
        PRODUCT_API_URL: props.productApiUrl,
      }),
      description: 'API Configuration for Web Portal',
    });
  }
}
