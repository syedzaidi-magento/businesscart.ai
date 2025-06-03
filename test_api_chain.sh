#!/bin/bash

# Configuration
USER_API="http://127.0.0.1:3000"
COMPANY_API="http://127.0.0.1:3001"
PRODUCT_API="http://127.0.0.1:3002"
EMAIL="company$(date +%s)@example.com" # Unique email
PASSWORD="securepassword"
ROLE="company"
NAME="Company User"
PHONE_NUMBER="1234567890"
COMPANY_CODE="CODE$(date +%s)" # Unique company code

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Function to check if jq is installed
check_jq() {
  if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is not installed. Please install jq to parse JSON responses.${NC}"
    echo "On Ubuntu: sudo apt-get install jq"
    exit 1
  fi
}

# Function to handle API errors
handle_error() {
  local response="$1"
  local step="$2"
  local status="$3" # HTTP status from curl
  local message=$(echo "$response" | jq -r '.message // "Unknown error"')

  # For registration, presence of accessToken indicates success
  if [ "$step" = "User Registration" ]; then
    local has_token=$(echo "$response" | jq -r '.accessToken // empty')
    if [ -n "$has_token" ] && [ "$status" -eq 200 ]; then
      return 0
    fi
  fi

  # Default error check
  if [ "$status" -ge 400 ]; then
    echo -e "${RED}Error in $step: HTTP $status - $message${NC}"
    echo "Response: $response"
    exit 1
  fi
}

# Check for jq
check_jq

echo "Starting API test chain..."

# Step 1: Register User
echo "1. Registering user ($EMAIL)..."
REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"role\":\"$ROLE\",\"phoneNumber\":\"$PHONE_NUMBER\"}")

# Split response and status
REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -n1)
REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | sed -e '$d')

echo "$REGISTER_BODY" | jq .
handle_error "$REGISTER_BODY" "User Registration" "$REGISTER_STATUS"

# Extract USER_ID from accessToken
USER_ID=$(echo "$REGISTER_BODY" | jq -r '.accessToken | split(".")[1] | @base64d | fromjson | .user.id // empty')
if [ -z "$USER_ID" ]; then
  echo -e "${RED}Error: Failed to extract user ID from accessToken${NC}"
  exit 1
fi
echo -e "${GREEN}User registered successfully. User ID: $USER_ID${NC}"

# Extract accessToken
JWT=$(echo "$REGISTER_BODY" | jq -r '.accessToken // empty')
if [ -z "$JWT" ]; then
  echo -e "${RED}Error: Failed to extract JWT from registration response${NC}"
  exit 1
fi

# Step 2: Login User (optional, since we have accessToken)
echo "2. Skipping login (using registration accessToken)..."
echo -e "${GREEN}Using JWT: $JWT${NC}"

# Step 3: Add Company
echo "3. Adding company (companyCode: $COMPANY_CODE)..."
COMPANY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$COMPANY_API/companies" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{
    \"name\": \"Test Company\",
    \"companyCode\": \"$COMPANY_CODE\",
    \"paymentMethods\": [\"cash\", \"credit_card\"],
    \"address\": {
      \"street\": \"123 Main St\",
      \"city\": \"Anytown\",
      \"state\": \"CA\",
      \"zip\": \"12345\",
      \"coordinates\": {
        \"lat\": 37.7749,
        \"lng\": -122.4194
      }
    },
    \"sellingArea\": {
      \"radius\": 10,
      \"center\": {
        \"lat\": 37.7749,
        \"lng\": -122.4194
      }
    }
  }")

COMPANY_STATUS=$(echo "$COMPANY_RESPONSE" | tail -n1)
COMPANY_BODY=$(echo "$COMPANY_RESPONSE" | sed -e '$d')

echo "$COMPANY_BODY" | jq .
handle_error "$COMPANY_BODY" "Add Company" "$COMPANY_STATUS"
COMPANY_ID=$(echo "$COMPANY_BODY" | jq -r '._id // .id // empty')
if [ -z "$COMPANY_ID" ]; then
  echo -e "${RED}Error: Failed to extract company ID from response${NC}"
  exit 1
fi
echo -e "${GREEN}Company added successfully. Company ID: $COMPANY_ID${NC}"

# Step 4: Add Product
echo "4. Adding product..."
PRODUCT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PRODUCT_API/products" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{\"name\":\"Widget\",\"price\":49.99,\"companyId\":\"$COMPANY_ID\",\"description\":\"A cool widget\"}")

PRODUCT_STATUS=$(echo "$PRODUCT_RESPONSE" | tail -n1)
PRODUCT_BODY=$(echo "$PRODUCT_RESPONSE" | sed -e '$d')

echo "$PRODUCT_BODY" | jq .
handle_error "$PRODUCT_BODY" "Add Product" "$PRODUCT_STATUS"
PRODUCT_ID=$(echo "$PRODUCT_BODY" | jq -r '._id // .id // empty')
if [ -z "$PRODUCT_ID" ]; then
  echo -e "${RED}Error: Failed to extract product ID from response${NC}"
  exit 1
fi
echo -e "${GREEN}Product added successfully. Product ID: $PRODUCT_ID${NC}"

echo -e "${GREEN}All API tests completed successfully!${NC}"