import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';

interface ProductServiceStackProps extends cdk.StackProps {
  api: apigateway.RestApi;
  authorizer: apigateway.TokenAuthorizer;
}

export class ProductServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ProductServiceStackProps) {
    super(scope, id, props);

    // Product Service Lambda
    const productServiceLambda = new lambda.Function(this, 'ProductServiceLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../product-service-lambda/dist')),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        NODE_ENV: 'development',
      },
    });

    // API Gateway Routes
    const products = props.api.root.addResource('products');
    const productId = products.addResource('{id}');
    const customer = products.addResource('customer');

    // Integrations
    const productIntegration = new apigateway.LambdaIntegration(productServiceLambda);
    products.addMethod('GET', productIntegration, {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    products.addMethod('POST', productIntegration, {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    productId.addMethod('GET', productIntegration, {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    productId.addMethod('PUT', productIntegration, {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    productId.addMethod('DELETE', productIntegration, {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });
    customer.addMethod('GET', productIntegration, {
      authorizer: props.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // CORS
    products.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'POST', 'OPTIONS'] });
    productId.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'] });
    customer.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'OPTIONS'] });
  }
}