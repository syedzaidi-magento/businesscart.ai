#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { UserServiceStack } from '../lib/user-service-stack';
import { CompanyServiceStack } from '../lib/company-service-stack';
import { ProductServiceStack } from '../lib/product-service-stack';
import { OrderServiceStack } from '../lib/order-service-stack';
import { CartServiceStack } from '../lib/cart-service-stack';
import { WebPortalStack } from '../lib/web-portal-stack';

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

// Order Service Stack
new OrderServiceStack(app, 'OrderServiceStack', {
  env: { region: 'us-east-1' },
});

// Cart Service Stack
new CartServiceStack(app, 'CartServiceStack', {
  env: { region: 'us-east-1' },
});

new WebPortalStack(app, 'WebPortalStack', {
  env: { region: 'us-east-1' },
  userApiUrl: 'https://user-api.example.com', // TODO: Replace with userServiceStack output
  companyApiUrl: 'https://company-api.example.com', // TODO: Replace with companyServiceStack output
  productApiUrl: 'https://product-api.example.com', // TODO: Replace with productServiceStack output
});
