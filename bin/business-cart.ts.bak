#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { UserServiceStack } from '../lib/user-service-stack';
import { CompanyServiceStack } from '../lib/company-service-stack';
import { ProductServiceStack } from '../lib/product-service-stack';

const app = new cdk.App();

// User Service Stack
new UserServiceStack(app, 'UserServiceStack', {
  env: { region: 'us-east-1' },
});

// Company Service Stack
new CompanyServiceStack(app, 'CompanyServiceStack', {
  env: { region: 'us-east-1' },
});

// Product Service Stack
new ProductServiceStack(app, 'ProductServiceStack', {
  env: { region: 'us-east-1' },
});