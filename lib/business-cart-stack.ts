import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { GoFunction } from '@aws-cdk/aws-lambda-go-alpha';
import { Construct } from 'constructs';
import { join } from 'path';

export interface BusinessCartStackProps extends cdk.StackProps {
  stage: string;
}

export class BusinessCartStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BusinessCartStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Project', 'BusinessCart');
    cdk.Tags.of(this).add('Stage', props.stage);

    const mongoUri = ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/MONGO_URI`);
    const jwtSecret = ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/JWT_SECRET`);
    const jwtRefreshSecret = ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/JWT_REFRESH_SECRET`);

    // Email/SMTP config — local stage uses empty (no-op sender), other stages read from SSM.
    // Same pattern as JWT_SECRET, MONGO_URI, CORS_ALLOWED_ORIGINS above.
    // Before deploying to a non-local stage, create these 5 SSM parameters:
    //   /BusinessCart/{stage}/EMAIL_FROM_ADDRESS    e.g., "noreply@businesscart.ai"
    //   /BusinessCart/{stage}/EMAIL_SMTP_HOST       e.g., "email-smtp.us-east-1.amazonaws.com"
    //   /BusinessCart/{stage}/EMAIL_SMTP_PORT       e.g., "587"
    //   /BusinessCart/{stage}/EMAIL_SMTP_USERNAME   SES SMTP username
    //   /BusinessCart/{stage}/EMAIL_SMTP_PASSWORD   SES SMTP password
    // If you're not ready to send real emails, set the values to empty strings —
    // the Lambda code falls back to a no-op sender automatically.
    // See process_email_setup.md for full setup instructions.
    const emailFromAddress = props.stage === 'local'
      ? ''
      : ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/EMAIL_FROM_ADDRESS`);
    const emailSmtpHost = props.stage === 'local'
      ? ''
      : ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/EMAIL_SMTP_HOST`);
    const emailSmtpPort = props.stage === 'local'
      ? ''
      : ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/EMAIL_SMTP_PORT`);
    const emailSmtpUsername = props.stage === 'local'
      ? ''
      : ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/EMAIL_SMTP_USERNAME`);
    const emailSmtpPassword = props.stage === 'local'
      ? ''
      : ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/EMAIL_SMTP_PASSWORD`);

    // Per-company branded email config — JSON map keyed by sellerId hex.
    // Customer-facing emails (welcome, password reset, order confirmation, quote events)
    // use the company's own SMTP so the customer sees their storefront brand.
    // Company-facing emails (statements, "new order"/"new customer" notifications) keep
    // using the BusinessCart SES creds above.
    //
    // SSM value shape (SecureString, JSON):
    //   {
    //     "<sellerIdHex>": {
    //       "fromAddress": "info@usetgo.com",
    //       "fromName":    "uSetGo",
    //       "smtpHost":    "mail.privateemail.com",
    //       "smtpPort":    "587",
    //       "smtpUsername":"info@usetgo.com",
    //       "smtpPassword":"<their password>",
    //       "ownerEmail":  "admin@usetgo.com"
    //     }
    //   }
    //
    // Adding a new custom-domain customer = edit JSON in SSM + cdk deploy. ZERO CDK
    // code change per customer. See process_custom_domain.md for the manual checklist.
    const emailCompanyConfigs = props.stage === 'local'
      ? '{}'
      : ssm.StringParameter.valueForStringParameter(this, `/BusinessCart/${props.stage}/EMAIL_COMPANY_CONFIGS`);

    const corsAllowedOrigins =
      props.stage === 'local'
        ? '*'
        : ssm.StringParameter.valueForStringParameter(
          this,
          `/BusinessCart/${props.stage}/CORS_ALLOWED_ORIGINS`
        );

    // Retrieve the API Gateway URL from SSM Parameter Store for deployed environments
    const catalogServiceUrlFromSsm = ssm.StringParameter.valueForStringParameter(
      this,
      `/BusinessCart/${props.stage}/ApiUrl`
    );

    const sharedGoFunctionProps = {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: props.stage === 'local' ? lambda.Architecture.X86_64 : lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(60),
      memorySize: 128,
      environment: {
        MONGO_URI: mongoUri,
        JWT_SECRET: jwtSecret,
        JWT_REFRESH_SECRET: jwtRefreshSecret,
        NODE_ENV: props.stage,
        CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
        // Define CATALOG_SERVICE_URL based on the stage
        CATALOG_SERVICE_URL: props.stage === 'local' ? 'http://host.docker.internal:3000' : catalogServiceUrlFromSsm,
        API_BASE_URL: props.stage === 'local' ? 'http://localhost:3000' : catalogServiceUrlFromSsm,
        // Email/SMTP — optional. Empty values trigger no-op sender (graceful local dev).
        EMAIL_FROM_ADDRESS: emailFromAddress,
        EMAIL_SMTP_HOST: emailSmtpHost,
        EMAIL_SMTP_PORT: emailSmtpPort,
        EMAIL_SMTP_USERNAME: emailSmtpUsername,
        EMAIL_SMTP_PASSWORD: emailSmtpPassword,
        // Per-company branded email — JSON, keyed by sellerId hex. See above comment.
        EMAIL_COMPANY_CONFIGS: emailCompanyConfigs,
        // Local-only escape hatch for Mailpit testing (Mailpit on plain port 1025
        // doesn't advertise STARTTLS, and Go's net/smtp refuses to send PLAIN auth
        // over plaintext). Set to "true" ONLY in local.env.json. Never in SSM /
        // production — production SES always negotiates STARTTLS automatically.
        EMAIL_SMTP_ALLOW_PLAINTEXT_AUTH: '',
      },
    };

    // Dedicated per-domain encryption key for ad-conversion credentials, mirroring
    // GATEWAY_ENCRYPTION_KEY. Scoped to account-service only (the dispatcher lives
    // here). Independently rotatable from JWT_SECRET.
    const conversionEncryptionKey = ssm.StringParameter.valueForStringParameter(
      this,
      `/BusinessCart/${props.stage}/CONVERSION_ENCRYPTION_KEY`
    );

    const accountService = new GoFunction(this, 'AccountHandler', {
      ...sharedGoFunctionProps,
      functionName: `AccountHandler-${props.stage}`,
      entry: join(__dirname, '..', 'account-service', 'cmd', 'server'),
      environment: {
        ...sharedGoFunctionProps.environment,
        CONVERSION_ENCRYPTION_KEY: conversionEncryptionKey,
      },
    });

    // --- Product Images Infrastructure ---
    const productImagesBucket = new s3.Bucket(this, 'ProductImagesBucket', {
      bucketName: `businesscart-product-images-${props.stage}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    const imagesCachePolicy = new cloudfront.ResponseHeadersPolicy(this, 'ImagesCacheHeaders', {
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cache-Control', value: 'public, max-age=31536000', override: true },
        ],
      },
    });

    const productImagesCdn = new cloudfront.Distribution(this, 'ProductImagesCdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(productImagesBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: imagesCachePolicy,
      },
    });

    const catalogService = new GoFunction(this, 'CatalogHandler', {
      ...sharedGoFunctionProps,
      functionName: `CatalogHandler-${props.stage}`,
      entry: join(__dirname, '..', 'catalog-service', 'cmd', 'server'),
      memorySize: 512,
      environment: {
        ...sharedGoFunctionProps.environment,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        PRODUCT_IMAGES_CDN: productImagesCdn.distributionDomainName,
      },
    });

    productImagesBucket.grantWrite(catalogService);

    const gatewayEncryptionKey = ssm.StringParameter.valueForStringParameter(
      this,
      `/BusinessCart/${props.stage}/GATEWAY_ENCRYPTION_KEY`
    );

    const checkoutService = new GoFunction(this, 'CheckoutHandler', {
      ...sharedGoFunctionProps,
      functionName: `CheckoutHandler-${props.stage}`,
      entry: join(__dirname, '..', 'checkout-service', 'cmd', 'server'),
      environment: {
        ...sharedGoFunctionProps.environment,
        GATEWAY_ENCRYPTION_KEY: gatewayEncryptionKey,
      },
    });

    // OPTIONS preflight: handled by API Gateway mock with '*' (cheap, no Lambda hit).
    // Actual requests: Lambda dynamically matches Origin against CORS_ALLOWED_ORIGINS.
    const api = new apigw.RestApi(this, 'UnifiedApi', {
      restApiName: `BusinessCart-API-${props.stage}`,
      description: 'Consolidated API for all BusinessCart services.',
      deployOptions: { stageName: props.stage },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
      },
    });

    api.addGatewayResponse('Cors4XX', {
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,Cookie'",
      },
    });

    api.addGatewayResponse('Cors5XX', {
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,Cookie'",
      },
    });

    const accountInteg = new apigw.LambdaIntegration(accountService, { allowTestInvoke: false });

    const accountsRoot = api.root.addResource('accounts');
    accountsRoot.addResource('register').addMethod('POST', accountInteg);
    accountsRoot.addResource('login').addMethod('POST', accountInteg);
    accountsRoot.addResource('refresh').addMethod('POST', accountInteg);
    accountsRoot.addResource('logout').addMethod('POST', accountInteg);
    accountsRoot.addResource('forgot-password').addMethod('POST', accountInteg);
    accountsRoot.addResource('reset-password').addMethod('POST', accountInteg);
    accountsRoot.addMethod('GET', accountInteg);
    const accountById = accountsRoot.addResource('{id}');
    accountById.addMethod('GET', accountInteg);
    accountById.addMethod('PATCH', accountInteg);
    accountById.addMethod('DELETE', accountInteg);
    accountById.addMethod('PUT', accountInteg);
    const regenerateStorefront = accountById.addResource('regenerate');
    regenerateStorefront.addMethod('POST', accountInteg);
    const locations = accountsRoot.addResource('locations');
    const locationByAccount = locations.addResource('{accountID}');
    locationByAccount.addMethod('GET', accountInteg);
    locationByAccount.addMethod('POST', accountInteg);
    const locationById = locationByAccount.addResource('{locationID}');
    locationById.addMethod('DELETE', accountInteg);
    const codes = api.root.addResource('codes');
    codes.addMethod('POST', accountInteg);
    codes.addMethod('GET', accountInteg);
    const codeByCode = codes.addResource('{code}');
    codeByCode.addMethod('GET', accountInteg);
    codeByCode.addMethod('DELETE', accountInteg);
    const customers = api.root.addResource('customers');
    const customerById = customers.addResource('{customerId}');
    const customerConfig = customerById.addResource('configuration');
    customerConfig.addMethod('PATCH', accountInteg);
    const customerAssociate = customerById.addResource('associate');
    customerAssociate.addMethod('PATCH', accountInteg);
    const visitors = api.root.addResource('visitors');
    visitors.addMethod('GET', accountInteg);
    visitors.addMethod('DELETE', accountInteg);
    const visitorEvent = visitors.addResource('event');
    visitorEvent.addMethod('POST', accountInteg);
    const visitorStats = visitors.addResource('stats');
    visitorStats.addMethod('GET', accountInteg);

    const catalogInteg = new apigw.LambdaIntegration(catalogService, { allowTestInvoke: false });
    const products = api.root.addResource('products');
    products.addMethod('POST', catalogInteg);
    products.addMethod('GET', catalogInteg);
    const uploadUrl = products.addResource('upload-url');
    uploadUrl.addMethod('POST', catalogInteg);
    const productId = products.addResource('{productId}');
    productId.addMethod('GET', catalogInteg);
    productId.addMethod('PUT', catalogInteg);
    productId.addMethod('DELETE', catalogInteg);

    const blog = api.root.addResource('blog');
    blog.addMethod('POST', catalogInteg);
    blog.addMethod('GET', catalogInteg);
    const blogPostId = blog.addResource('{blogPostId}');
    blogPostId.addMethod('GET', catalogInteg);
    blogPostId.addMethod('PUT', catalogInteg);
    blogPostId.addMethod('DELETE', catalogInteg);

    const checkoutInteg = new apigw.LambdaIntegration(checkoutService, { allowTestInvoke: false });
    const checkoutRoot = api.root.addResource('checkout');
    checkoutRoot.addMethod('POST', checkoutInteg);
    const cart = checkoutRoot.addResource('cart');
    cart.addMethod('POST', checkoutInteg);
    cart.addMethod('GET', checkoutInteg);
    cart.addMethod('DELETE', checkoutInteg);
    const cartItem = cart.addResource('{itemId}');
    cartItem.addMethod('PUT', checkoutInteg);
    cartItem.addMethod('DELETE', checkoutInteg);
    const quotes = checkoutRoot.addResource('quotes');
    quotes.addMethod('POST', checkoutInteg);
    quotes.addMethod('GET', checkoutInteg); // Add GET method for listing quotes
    const quoteId = quotes.addResource('{quoteId}');
    quoteId.addMethod('GET', checkoutInteg);
    quoteId.addMethod('DELETE', checkoutInteg);
    quoteId.addMethod('PATCH', checkoutInteg);
    const orders = checkoutRoot.addResource('orders');
    orders.addMethod('POST', checkoutInteg);
    orders.addMethod('GET', checkoutInteg);
    const orderStatement = orders.addResource('statement');
    orderStatement.addMethod('GET', checkoutInteg);
    orderStatement.addResource('send').addMethod('POST', checkoutInteg);
    const orderExport = orders.addResource('export');
    orderExport.addMethod('GET', checkoutInteg);
    const orderById = orders.addResource('{orderId}');
    orderById.addMethod('DELETE', checkoutInteg);
    orderById.addMethod('PUT', checkoutInteg);
    const statements = checkoutRoot.addResource('statements');
    statements.addMethod('GET', checkoutInteg);
    const statementById = statements.addResource('{statementId}');
    statementById.addMethod('PUT', checkoutInteg);
    statementById.addMethod('DELETE', checkoutInteg);

    // Gateway config management (company/admin)
    const gateways = checkoutRoot.addResource('gateways');
    const gatewayBySeller = gateways.addResource('{sellerId}');
    gatewayBySeller.addMethod('PUT', checkoutInteg);
    gatewayBySeller.addMethod('GET', checkoutInteg);
    const gatewayByName = gatewayBySeller.addResource('{gateway}');
    gatewayByName.addMethod('DELETE', checkoutInteg);

    // Payment return callback (browser redirect from payment providers, no auth)
    const paymentReturn = checkoutRoot.addResource('payment-return');
    paymentReturn.addMethod('GET', checkoutInteg);


    new cdk.CfnOutput(this, 'UnifiedApiUrl', { value: api.url });

    const portalBucket = new s3.Bucket(this, 'WebPortalBucket', {
      bucketName: `web-portal-bucket-${props.stage}`,
      websiteIndexDocument: 'index.html',
      versioned: false,
      intelligentTieringConfigurations: [
        // { name: 'FreeTier', prefix: 'web-portal/' },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const viteApiUrl = props.stage === 'local'
      ? 'http://127.0.0.1:3000'
      : ssm.StringParameter.valueFromLookup(
        this,
        `/BusinessCart/${props.stage}/ApiUrl`
      );

    new s3deploy.BucketDeployment(this, 'DeployWebPortal', {
      sources: [
        s3deploy.Source.asset(join(__dirname, '..', 'web-portal'), {
          bundling: {
            image: cdk.DockerImage.fromRegistry('node:20'),
            command: [
              'bash',
              '-c',
              'npm install && npm run build && mv dist/* /asset-output/',
            ],
            environment: {
              VITE_API_URL: viteApiUrl,
            },
            user: 'root',
          },
        }),
      ],
      destinationBucket: portalBucket,
      cacheControl: [
        s3deploy.CacheControl.maxAge(cdk.Duration.hours(1)),
        s3deploy.CacheControl.setPublic(),
      ],
      prune: false,
    });
    new cdk.CfnOutput(this, 'ViteApiUrlFromSsm', { value: viteApiUrl });

    new cdk.CfnOutput(this, 'WebPortalUrl', { value: portalBucket.bucketWebsiteUrl });

    // --- Custom Domain and CDN for Web Portal ---

    const domainName = 'businesscart.ai';
    const zoneName = 'businesscart.ai';
    const hostedZoneId = 'Z08097461K3514HDMUTR6';

    // Look up the hosted zone in Route 53
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: hostedZoneId,
      zoneName: zoneName,
    });

    // Combined ACM certificate covering businesscart.ai + *.businesscart.ai + custom domains
    // Managed via CLI (not CDK) — see memory/process_custom_domain.md
    const certificate = acm.Certificate.fromCertificateArn(this, 'SiteCertificate',
      'arn:aws:acm:us-east-1:750495979823:certificate/79a2ca84-2749-4784-9a6e-5e1c000f275d'
    );

    // Rewrite /path → /path/index.html for pre-rendered pages
    const portalRoutingFunction = new cloudfront.Function(this, 'PortalRoutingFunction', {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;
          if (uri.endsWith('/')) {
            request.uri += 'index.html';
          } else if (!uri.includes('.')) {
            request.uri += '/index.html';
          }
          return request;
        }
      `),
    });

    // Security response headers for portal and storefront
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(31536000),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
      },
    });

    // Create a CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(portalBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          {
            function: portalRoutingFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      domainNames: [domainName],
      certificate: certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Create a Route 53 'A' record to point the domain to the CloudFront distribution
    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      zone: hostedZone,
    });



    // Email DNS records (MX, SPF, DKIM) managed via AWS CLI — not CDK.
    // See Route 53 hosted zone Z08097461K3514HDMUTR6 for current values.

    // Output the CloudFront distribution domain name
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    });

    // --- D2C Storefronts Infrastructure ---

    const d2cStorefrontBucket = new s3.Bucket(this, 'D2CStorefrontBucket', {
      bucketName: `businesscart-d2c-storefronts-${props.stage}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Grant accountService permission to write to this bucket and invalidate CloudFront
    d2cStorefrontBucket.grantReadWrite(accountService);
    accountService.addEnvironment('D2C_BUCKET_NAME', d2cStorefrontBucket.bucketName);

    // CloudFront Function for subdomain routing
    const routingFunction = new cloudfront.Function(this, 'D2CRoutingFunction', {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var host = request.headers.host.value;

          // Manual Custom Domain Mapping Table
          // Populate this manually for clients who bring their own domains
          var domainMap = {
            'www.usetgo.com': 'ui-sid-888'
          };

          // Reverse Mapping (For Redirection Logic)
          var reverseMap = {
            'ui-sid-888': 'www.usetgo.com'
          };

          // Redirect www.businesscart.ai to businesscart.ai
          if (host === 'www.businesscart.ai') {
            return {
              statusCode: 301,
              statusDescription: 'Moved Permanently',
              headers: {
                'location': { value: 'https://businesscart.ai' + request.uri }
              }
            };
          }

          var companyId = '';

          // 1. Direct hit on a Custom Domain
          if (domainMap[host]) {
            companyId = domainMap[host];
          } 
          // 2. Hit on a Preview Subdomain (*.businesscart.ai)
          else if (host.endsWith('.businesscart.ai') && host !== 'businesscart.ai' && !host.startsWith('api.')) {
            companyId = host.split('.')[0];

            // SEO: Redirect to Custom Domain if one exists
            if (reverseMap[companyId]) {
              return {
                statusCode: 301,
                statusDescription: 'Moved Permanently',
                headers: {
                  'location': { value: 'https://' + reverseMap[companyId] + request.uri }
                }
              };
            }
          }

          // If we found a companyId, rewrite to the S3 folder
          if (companyId) {
            request.uri = '/storefronts/' + companyId + request.uri;
            if (request.uri.endsWith('/')) {
              request.uri += 'index.html';
            }
          }

          return request;
        }
      `),
    });

    // CloudFront Distribution for D2C Storefronts
    const d2cDistribution = new cloudfront.Distribution(this, 'D2CDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(d2cStorefrontBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          {
            function: routingFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      domainNames: ['*.businesscart.ai', 'www.usetgo.com'],
      certificate: certificate,
    });

    // Grant accountService permission to invalidate D2C CloudFront cache after storefront regeneration
    d2cDistribution.grant(accountService, 'cloudfront:CreateInvalidation');
    accountService.addEnvironment('D2C_DISTRIBUTION_ID', d2cDistribution.distributionId);

    // Create a Wildcard A record to point all subdomains to CloudFront
    new route53.ARecord(this, 'WildcardD2CRecord', {
      recordName: '*.businesscart.ai',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(d2cDistribution)),
      zone: hostedZone,
    });

    // Outputs
    new cdk.CfnOutput(this, 'D2CBucketName', { value: d2cStorefrontBucket.bucketName });
    new cdk.CfnOutput(this, 'D2CDistributionDomain', { value: d2cDistribution.distributionDomainName });
    new cdk.CfnOutput(this, 'ProductImagesBucketName', { value: productImagesBucket.bucketName });
    new cdk.CfnOutput(this, 'ProductImagesCdnDomain', { value: productImagesCdn.distributionDomainName });
  }
}