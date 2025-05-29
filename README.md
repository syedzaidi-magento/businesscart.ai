# BusinessCart

BusinessCart is a serverless e-commerce platform built with AWS CDK, enabling companies to manage products and customers. It uses API Gateway, Lambda, and MongoDB Atlas for data storage, with a custom authorizer for secure access.

## Features
- **User Management**: Register, login, refresh tokens, and logout.
- **Company Management**: Create, retrieve, update, and delete company profiles.
- **Product Management**: Add, retrieve, update, and delete products for companies.
- **Secure Authorization**: Custom Lambda authorizer with JWT-based authentication.
- **Internal API Calls**: Bypasses user tokens using `X-Internal-Request` header.

## Prerequisites
- **Node.js**: v18.x or later
- **AWS CLI**: v2.x, configured with credentials
- **AWS SAM CLI**: v1.123.0 or later
- **Docker**: v28.1.1 or later, running
- **MongoDB Atlas**: Connection string for database
- **Ubuntu**: 24.04.2 LTS (or compatible OS)

## Setup
1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd BusinessCart
   ```

2. **Install Dependencies**:
   ```bash
   cd cdk
   npm install
   cd ../authorizer-lambda
   npm install
   cd ../company-service-lambda
   npm install
   cd ../product-service-lambda
   npm install
   cd ../user-service-lambda
   npm install
   ```

3. **Configure Environment Variables**:
   Create `.env` files in each Lambda directory (`authorizer-lambda`, `company-service-lambda`, `product-service-lambda`, `user-service-lambda`) with:
   ```plaintext
   MONGO_URI=<your-mongodb-atlas-uri>
   JWT_SECRET=<your-jwt-secret>
   NODE_ENV=development
   ```
   For `authorizer-lambda`, add:
   ```plaintext
   COMPANY_SERVICE_URL=http://192.168.12.151:3000
   ```

4. **Synthesize CDK Template**:
   ```bash
   cd ~/BusinessCart/cdk
   npm run build
   cdk synth
   ```

## API Testing Instructions
BusinessCart uses AWS SAM CLI for local API testing, simulating API Gateway and Lambda functions. Follow these steps to test the `users`, `companies`, and `products` endpoints.

### Start Local API
Run SAM with host networking to avoid `ECONNREFUSED`:

```bash
cd ~/BusinessCart
export COMPANY_SERVICE_URL=http://192.168.12.151:3000
sam local start-api -t cdk.out/CdkBackendStack.template.json --log-file sam.log --host 0.0.0.0 --docker-network host --env-vars <(echo "{\"AuthorizerLambda\": {\"COMPANY_SERVICE_URL\": \"$COMPANY_SERVICE_URL\"}}")
```

**Verify**: API runs at `http://127.0.0.1:3000`.

### Check SAM Containers
Ensure SAM containers are running:

```bash
docker ps
```

**Expected**: Containers like `public.ecr.aws/lambda/nodejs:18-rapid-x86_64` (Lambda) and API Gateway container. If empty, debug:

```bash
docker ps -a | grep -E 'amazon/aws-sam|public.ecr.aws/lambda'
docker logs <container_id>
sam local start-api -t cdk.out/CdkBackendStack.template.json --log-file sam.log --host 0.0.0.0 --docker-network host --env-vars <(echo "{\"AuthorizerLambda\": {\"COMPANY_SERVICE_URL\": \"$COMPANY_SERVICE_URL\"}}") --debug
```

### Generate JWT
Obtain an access token:

```bash
curl -X POST http://127.0.0.1:3000/users/login \
-H "Content-Type: application/json" \
-d '{"username":"testuser","password":"test123"}'
```

**Response**:
```json
{
  "accessToken": "<jwt-token>",
  "refreshToken": "<refresh-token>"
}
```

### Test Endpoints
Use the `accessToken` for authenticated requests. Internal calls use `X-Internal-Request` to bypass user token dependency.

#### GET /companies
Retrieve companies:

```bash
curl -X GET http://127.0.0.1:3000/companies \
-H "Authorization: Bearer <accessToken>"
```

**Expected**:
```json
[
  {
    "_id": "68313d273cca3b4842508d95",
    "name": "Test Company",
    "userId": "68313d273cca3b4842508d94",
    "companyCode": "987654322",
    ...
  }
]
```

#### POST /companies
Create a company:

```bash
curl -X POST http://127.0.0.1:3000/companies \
-H "Content-Type: application/json" \
-H "Authorization: Bearer <accessToken>" \
-d '{"name":"Test Company","userId":"68313d273cca3b4842508d94","companyCode":"987654322","paymentMethods":["cash","credit_card"],"address":{"street":"123 Main St","city":"Anytown","state":"CA","zip":"12345","coordinates":{"lat":37.7749,"lng":-122.4194}},"sellingArea":{"radius":10,"center":{"lat":37.7749,"lng":-122.4194}}}'
```

**Expected**:
```json
{
  "_id": "68313d273cca3b4842508d95",
  "name": "Test Company",
  ...
}
```

#### POST /products
Create a product:

```bash
curl -X POST http://127.0.0.1:3000/products \
-H "Content-Type: application/json" \
-H "Authorization: Bearer <accessToken>" \
-d '{"name":"Product 1","price":10,"category":"electronics","stock":100}'
```

**Expected**:
```json
{
  "_id": "68313d273cca3b4842508d96",
  "name": "Product 1",
  ...
}
```

### Troubleshoot Common Issues
- **No Containers in `docker ps`**:
  - Check stopped containers:
    ```bash
    docker ps -a | grep -E 'amazon/aws-sam|public.ecr.aws/lambda'
    ```
  - Restart Docker:
    ```bash
    sudo systemctl restart docker
    ```
  - Verify port 3000:
    ```bash
    netstat -tuln | grep 3000
    ```

- **ECONNREFUSED**:
  - Test from `authorizer-lambda` container:
    ```bash
    docker exec -it <authorizer_lambda_container_id> sh
    apk add curl
    curl http://192.168.12.151:3000/companies
    ```
  - Use bridge network:
    ```bash
    docker network create sam-network
    export COMPANY_SERVICE_URL=http://host-gateway:3000
    sam local start-api -t cdk.out/CdkBackendStack.template.json --log-file sam.log --host 0.0.0.0 --docker-network sam-network --extra-hosts '{"host-gateway":"192.168.12.151"}' --env-vars <(echo "{\"AuthorizerLambda\": {\"COMPANY_SERVICE_URL\": \"$COMPANY_SERVICE_URL\"}}")
    ```

- **403 Forbidden**:
  - Ensure `X-Internal-Request` is configured in `cdk-backend/cdk/lib/cdk-backend-stack.ts` and `authorizer-lambda/src/handler/handler.ts`.
  - Check SAM logs:
    ```bash
    tail -f ~/BusinessCart/sam.log
    ```

## Project Structure
- **cdk/**: AWS CDK infrastructure code
- **authorizer-lambda/**: Custom authorizer Lambda
- **company-service-lambda/**: Company management Lambda
- **product-service-lambda/**: Product management Lambda
- **user-service-lambda/**: User management Lambda

## Contributing
1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/your-feature`).
3. Commit changes (`git commit -am 'Add feature'`).
4. Push to the branch (`git push origin feature/your-feature`).
5. Create a pull request.

## License
MIT License