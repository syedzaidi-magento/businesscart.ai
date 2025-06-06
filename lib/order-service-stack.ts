import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';

export class OrderServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Authorizer Lambda
    const authorizerFn = new lambda.Function(this, 'OrderAuthorizer', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'authorizer.handler',
      code: lambda.Code.fromAsset('order-service/dist'),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
        NODE_ENV: 'development',
      },
    });

    // Order Service Lambda
    const orderServiceLambda = new lambda.Function(this, 'OrderService', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('order-service/dist'),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
        NODE_ENV: 'development',
      },
      timeout: cdk.Duration.seconds(30),
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'OrderApi', {
      restApiName: 'Order Service API',
      description: 'API for Order Service',
      deployOptions: {
        stageName: 'dev',
      },
    });

    // Token Authorizer
    const authorizer = new apigateway.TokenAuthorizer(this, 'OrderJwtAuthorizer', {
      handler: authorizerFn,
      identitySource: 'method.request.header.Authorization',
    });

    // API Routes
    const orders = api.root.addResource('orders');
    const orderId = orders.addResource('{orderId}');

    // Integrations
    const orderIntegration = new apigateway.LambdaIntegration(orderServiceLambda);
    orders.addMethod('POST', orderIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    orders.addMethod('GET', orderIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    orderId.addMethod('GET', orderIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    orderId.addMethod('PUT', orderIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    orderId.addMethod('DELETE', orderIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // CORS
    orders.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'POST', 'OPTIONS'] });
    orderId.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'] });

    // Output API Endpoint
    new cdk.CfnOutput(this, 'OrderApiUrl', {
      value: api.url,
      description: 'Order Service API Endpoint',
    });
  }
}
