# BusinessCart

BusinessCart is an enterprise-grade platform for managing companies and products, featuring a modern web portal built with React, TypeScript, and Tailwind CSS, integrated with serverless AWS APIs. The application supports user authentication, company management, and product CRUD operations, with a responsive UI featuring a dark-themed sidebar for navigation and a dynamic navbar for user data.

## Table of Contents
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Locally](#running-locally)
- [Building the Web Portal](#building-the-web-portal)
- [Deploying to AWS](#deploying-to-aws)
- [Testing APIs](#testing-apis)
- [Decoding JWT Tokens](#decoding-jwt-tokens)
- [Troubleshooting](#troubleshooting)

## Project Structure
```
BusinessCart/
├── web-portal/           # React web portal (Vite, TypeScript, Tailwind CSS)
├── product-service/      # Product API (AWS SAM, port 3002)
├── company-service/      # Company API (AWS SAM, port 3001)
├── auth-service/         # Authentication API (AWS SAM, port 3000)
├── template.yaml         # AWS SAM template (root level, if applicable)
├── README.md             # This file
```

- **Web Portal**: A single-page application with a dark sidebar (`bg-gray-800`) for primary navigation (`/dashboard`, `/companies`, `/products`), a dynamic navbar for user initials, notifications, cart, and company name, and pages for login, registration, dashboard, company management, and product management.
- **APIs**: Serverless AWS Lambda functions with API Gateway, handling authentication, company CRUD, and product CRUD.

## Prerequisites
- **Node.js**: v18 or higher (`node -v`)
- **npm**: v8 or higher (`npm -v`)
- **AWS CLI**: Configured with credentials (`aws configure`)
- **AWS SAM CLI**: For local API testing (`sam --version`)
- **Docker**: For SAM local API emulation
- **net-tools**: For checking ports (`sudo apt install net-tools` on Ubuntu)
- **jq**: For JWT decoding (`sudo apt install jq jq` on Ubuntu)
- **Git**: For version control (`git clone <repo-url>`)

## Setup
1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd ~/Documents/BusinessCart
   ```

2. **Install web portal dependencies**:
   ```bash
   cd web-portal
   npm install
   ```

3. **Configure environment variables**:
   Create `WEB-PORTAL/.env` with:
   ```bash
   cat > web-portal/.env << EOF
   VITE_AUTH_API_URL=http://127.0.0.1:3000
   VITE_AUTH_API_URL=https://127.0.0.1:3000
   VITE_COMPANY_API_URL=http://127.0.0.1:3001
   VITE_COMPANY_API_URL=https://127.0.0.1:3001
   VITE_PRODUCT_API_URL=http://127.0.0.1:3002
   EOF
   VITE_PRODUCT_API_URL=https://127.0.0.1:3002
   ```
   Verify:
   ```bash
   cat web-portal/.env
   ```

## Running Locally
### 1. Start APIs
Run each API in a separate terminal using AWS SAM:
```bash
cd ~/Documents/BusinessCart/auth-service
sam local start-api --template template.yaml --port 3000 &
cd ~/Documents/BusinessCart/company-service
sam local start-api --template template.yaml --port 3001 &
cd ~/Documents/BusinessCart/product-service
sam local start-api --template template.yaml --port 3002 &
```

Verify ports are listening:
```bash
sudo apt install net-tools  # Install net-tools if not present
netstat -tuln | grep -E '3000|3001|3002'
```
Expected output:
```
tcp        0      0 127.0.0.1:3000          0.0.0.0:*               LISTEN
tcp        0      0 127.0.0.1:3001          0.0.0.0:*               LISTEN
tcp        0      0 127.0.0.1:3002          0.0.0.0:*               LISTEN
```

### 2. Start Web Portal
```bash
cd ~/Documents/BusinessCart/web-portal
npm start
```
- Access: `http://localhost:5173`
- **Login**: Use `email: company$(date +%s)@example.com`, `password: securepassword`
- **Features**:
  - **Sidebar**: Dark-themed (`bg-gray-800`), links to `/dashboard`, `/companies`, `/products` with active style (`bg-gray-900`, `text-white`, `border-l-4 border-blue-500`).
  - **Navbar**: Displays user initials, notifications (placeholder), cart (placeholder), company name, and logout.
  - **Dashboard**: Shows product count (cached) and company placeholder.
  - **Companies/Products**: Manage via forms with Tailwind CSS UI.

## Building the Web Portal
```bash
cd ~/Documents/BusinessCart/web-portal
npm run build
```
- Output: `dist/` folder with static assets.
- Verify: Check `dist/index.html` and `dist/assets/`.

## Deploying to AWS
1. **Build web portal** (as above).
2. **Deploy with AWS CDK**:
   ```bash
   cd ~/Documents/BusinessCart
   cdk deploy WebPortalStack
   ```
3. **Note**: Ensure `cdk.json` and `template.yaml` are configured for your stacks.

## Testing APIs
Test the auth API:
```bash
curl -X POST http://127.0.0.1:3000/login -H "Content-Type: application/json" -d '{"email":"company@example.com","password":"securepassword"}'
```
Expected response:
```json
{
  "accessToken": "<JWT_TOKEN>"
}
```

Test product API (requires `accessToken`):
```bash
curl -X GET http://127.0.0.1:3002/products -H "Authorization: Bearer <JWT_TOKEN>"
```

## Decoding JWT Tokens
Decode the `accessToken` stored in `localStorage` to inspect user data (e.g., `user.name`, `user.email`, `user.companyName`).

1. **Get Token**:
   - In browser: Open `http://localhost:5173`, login, then run in console:
     ```javascript
     localStorage.getItem('accessToken')
     ```
   - Copy the token.

2. **Decode with `jq`**:
   ```bash
   echo '<JWT_TOKEN>' | cut -d '.' -f 2 | base64 -d | jq
   ```
   Example output:
   ```json
   {
     "user": {
       "email": "company@example.com",
       "name": "John Doe",
       "companyName": "Example Corp"
     },
     "iat": 1625097600,
     "exp": 1625184000
   }
   ```

3. **Decode with Node.js** (alternative):
   ```bash
   node -e "console.log(JSON.parse(Buffer.from('<JWT_TOKEN>'.split('.')[1], 'base64').toString()))"
   ```

**Install `jq`** (if needed):
```bash
sudo apt install jq
```

## Troubleshooting
- **API Not Running**:
  - Check logs: `cat ~/Documents/BusinessCart/sam-*.log`
  - Restart SAM: Kill processes (`killall sam`) and rerun `sam local start-api`.
- **Web Portal Errors**:
  - Console logs: Open F12 > Console in browser.
  - Network tab: Verify API calls to `http://127.0.0.1:3000`, `3001`, `3002`.
- **Build Fails**:
  - Run `tsc` to check TypeScript errors: `cd web-portal; npx tsc`.
  - Verify `api.ts` matches API signatures (e.g., `login({ email, password })`).
- **JWT Issues**:
  - Ensure token is valid: Decode with `jq` or Node.js.
  - Check `api.ts` for correct `Authorization` header.

For issues, share:
- Console logs (F12 > Console)
- SAM logs (`cat ~/Documents/BusinessCart/sam-*.log`)
- `api.ts` if API calls fail
- Network tab screenshots