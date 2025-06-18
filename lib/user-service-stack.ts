import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { config } from 'dotenv';
config({ path: './user-service/dist/.env' });


export class UserServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // UserService Lambda
    const userServiceFn = new lambda.Function(this, 'UserService', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('user-service/dist'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
        NODE_ENV: 'development',
      },
    });

    // API Gateway for UserService
    const userApi = new apigateway.LambdaRestApi(this, 'UserServiceEndpoint', {
      handler: userServiceFn,
      restApiName: 'UserApi',
      proxy: false,
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
      },
    });
    const users = userApi.root.addResource('users');
    users.addResource('register').addMethod('POST', new apigateway.LambdaIntegration(userServiceFn));
    users.addResource('login').addMethod('POST', new apigateway.LambdaIntegration(userServiceFn));
    users.addResource('refresh').addMethod('POST', new apigateway.LambdaIntegration(userServiceFn));
    users.addResource('logout').addMethod('POST', new apigateway.LambdaIntegration(userServiceFn));
    users.addResource('associate-company').addMethod('POST', new apigateway.LambdaIntegration(userServiceFn));
    const userId = users.addResource('{id}');
    userId.addMethod('PATCH', new apigateway.LambdaIntegration(userServiceFn));

    new cdk.CfnOutput(this, 'UserServiceApiUrl', { value: userApi.url });
  }
}