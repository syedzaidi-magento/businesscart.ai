import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';

export class CartServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Authorizer Lambda
    const authorizerFn = new lambda.Function(this, 'CartAuthorizer', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'authorizer.handler',
      code: lambda.Code.fromAsset('cart-service/dist'),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
        NODE_ENV: 'development',
      },
    });

    // Cart Service Lambda
    const cartServiceLambda = new lambda.Function(this, 'CartService', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('cart-service/dist'),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
        NODE_ENV: 'development',
      },
      timeout: cdk.Duration.seconds(30),
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'CartApi', {
      restApiName: 'Cart Service API',
      description: 'API for Cart Service',
      deployOptions: {
        stageName: 'dev',
      },
    });

    // Token Authorizer
    const authorizer = new apigateway.TokenAuthorizer(this, 'CartJwtAuthorizer', {
      handler: authorizerFn,
      identitySource: 'method.request.header.Authorization',
    });

    // API Routes
    const cart = api.root.addResource('cart');
    const cartItem = cart.addResource('{itemId}');

    // Integrations
    const cartIntegration = new apigateway.LambdaIntegration(cartServiceLambda);
    cart.addMethod('POST', cartIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    cart.addMethod('GET', cartIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    cartItem.addMethod('PUT', cartIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    cartItem.addMethod('DELETE', cartIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // CORS
    cart.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'POST', 'OPTIONS'] });
    cartItem.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['PUT', 'DELETE', 'OPTIONS'] });

    // Output API Endpoint
    new cdk.CfnOutput(this, 'CartApiUrl', {
      value: api.url,
      description: 'Cart Service API Endpoint',
    });
  }
}