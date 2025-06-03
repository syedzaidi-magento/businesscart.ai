import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class CompanyServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Authorizer Lambda
    const authorizerLambda = new lambda.Function(this, 'CompanyAuthorizerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'authorizer.handler',
      code: lambda.Code.fromAsset('company-service/dist'),
      environment: {
        JWT_SECRET: process.env.JWT_SECRET || '',
      },
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'CompanyServiceApi', {
      restApiName: 'Company Service API',
      description: 'API for BusinessCart Company Service',
    });

    // Token Authorizer
    const authorizer = new apigateway.TokenAuthorizer(this, 'CompanyTokenAuthorizer', {
      handler: authorizerLambda,
      identitySource: 'method.request.header.Authorization',
    });

    // Company Service Lambda
    const companyServiceLambda = new lambda.Function(this, 'CompanyServiceLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('company-service/dist'),
      environment: {
        MONGO_URI: process.env.MONGO_URI || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        NODE_ENV: 'development',
      },
    });

    // API Gateway Routes
    const companies = api.root.addResource('companies');
    const companyId = companies.addResource('{companyId}');
    const customers = companyId.addResource('customers');
    const customer = companies.addResource('customers');
    const customerId = customer.addResource('{customerId}');
    const code = companies.addResource('code');
    const codeValue = code.addResource('{code}');
    const codeCustomers = codeValue.addResource('customers');

    // Integrations
    const companyIntegration = new apigateway.LambdaIntegration(companyServiceLambda);
    companies.addMethod('GET', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    companies.addMethod('POST', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    companyId.addMethod('GET', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    companyId.addMethod('PUT', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    companyId.addMethod('DELETE', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    customers.addMethod('POST', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    customerId.addMethod('GET', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    code.addMethod('POST', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    codeValue.addMethod('GET', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });
    codeCustomers.addMethod('POST', companyIntegration, { authorizer, authorizationType: apigateway.AuthorizationType.CUSTOM });

    // CORS
    companies.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'POST', 'OPTIONS'] });
    companyId.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'] });
    customers.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['POST', 'OPTIONS'] });
    customer.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['POST', 'OPTIONS'] });
    customerId.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'OPTIONS'] });
    code.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['POST', 'OPTIONS'] });
    codeValue.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['GET', 'OPTIONS'] });
    codeCustomers.addCorsPreflight({ allowOrigins: ['*'], allowMethods: ['POST', 'OPTIONS'] });
  }
}