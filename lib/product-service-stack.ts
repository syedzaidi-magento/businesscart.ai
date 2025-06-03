import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';

export class ProductServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Authorizer Lambda
    const authorizerFn = new lambda.Function(this, 'ProductAuthorizer', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'authorizer.handler',
      code: lambda.Code.fromAsset('product-service/dist'),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
        NODE_ENV: 'development',
      },
    });

    // Product Service Lambda
    const productServiceLambda = new lambda.Function(this, 'ProductService', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('product-service/dist'),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
        NODE_ENV: 'development',
      },
      timeout: cdk.Duration.seconds(30),
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'ProductApi', {
      restApiName: 'Product Service API',
      description: 'API for Product Service',
      deployOptions: {
        stageName: 'dev',
      },
    });

    // Token Authorizer
    const authorizer = new apigateway.TokenAuthorizer(this, 'ProductJwtAuthorizer', {
      handler: authorizerFn,
      identitySource: 'method.request.header.Authorization',
    });

    // API Routes
    const products = api.root.addResource('products');
    const productId = products.addResource('{productId}');

    // Integrations
    const productIntegration = new apigateway.LambdaIntegration(productServiceLambda);
    products.addMethod('POST', productIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    products.addMethod('GET', productIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    productId.addMethod('GET', productIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    productId.addMethod('PUT', productIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    productId.addMethod('DELETE', productIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // CORS
    products.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'POST', 'OPTIONS'] });
    productId.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'] });

    // Output API Endpoint
    new cdk.CfnOutput(this, 'ProductApiUrl', {
      value: api.url,
      description: 'Product Service API Endpoint',
    });
  }
}