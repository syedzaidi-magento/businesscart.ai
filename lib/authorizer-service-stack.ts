import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';

interface AuthorizerStackProps extends cdk.StackProps {
  api: apigateway.RestApi;
}

export class AuthorizerServiceStack extends cdk.Stack {
  public readonly authorizer: apigateway.TokenAuthorizer;

  constructor(scope: Construct, id: string, props: AuthorizerStackProps) {
    super(scope, id, props);

    // Authorizer Lambda
    const authorizerLambda = new lambda.Function(this, 'AuthorizerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../authorizer-lambda/dist')),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        COMPANY_SERVICE_URL: process.env.COMPANY_SERVICE_URL || 'http://192.168.12.391:3000',
        NODE_ENV: 'development',
      },
    });

    // Token Authorizer
    this.authorizer = new apigateway.TokenAuthorizer(this, 'CompanyTokenAuthorizer', {
      handler: authorizerLambda,
      identitySource: 'method.request.header.Authorization',
    });
  }
}