#!/bin/bash

# Configuration
USER_API="http://127.0.0.1:3000"
COMPANY_API="http://127.0.0.1:3001"
PRODUCT_API="http://127.0.0.1:3002"
ORDER_API="http://127.0.0.1:3003"
EMAIL="company@example.com"
PASSWORD="securepassword"
ROLE="company"
NAME="company User"
PHONE_NUMBER="1234567890"
COMPANY_CODE="CODE12345"
JWT=""

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
  local status="$3"
  local message=$(echo "$response" | jq -r '.message // "Unknown error"')
  if [ "$status" -ge 400 ]; then
    echo -e "${RED}Error in $step: HTTP $status - $message${NC}"
    echo "Response: $response"
    exit 1
  fi
}

# Check for jq
check_jq

echo "Starting specific user API test chain..."

# Step 1: Login User or Register
echo "1. Attempting to login user ($EMAIL)..."
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
LOGIN_STATUS=$(echo "$LOGIN_RESPONSE" | tail -n1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed -e '$d')

if [ "$LOGIN_STATUS" -eq 200 ]; then
  echo "$LOGIN_BODY" | jq .
  JWT=$(echo "$LOGIN_BODY" | jq -r '.accessToken // empty')
  if [ -z "$JWT" ]; then
    echo -e "${RED}Error: Failed to extract JWT from login response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Login successful. JWT: $JWT${NC}"
else
  echo -e "${RED}Login failed (HTTP $LOGIN_STATUS). Attempting to register user...${NC}"
  REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"role\":\"$ROLE\",\"phoneNumber\":\"$PHONE_NUMBER\"}")
  REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -n1)
  REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | sed -e '$d')
  echo "$REGISTER_BODY" | jq .
  handle_error "$REGISTER_BODY" "User Registration" "$REGISTER_STATUS"
  JWT=$(echo "$REGISTER_BODY" | jq -r '.accessToken // empty')
  if [ -z "$JWT" ]; then
    echo -e "${RED}Error: Failed to extract JWT from registration response${NC}"
    exit 1
  fi
  echo -e "${GREEN}User registered successfully. JWT: $JWT${NC}"
fi

# Extract USER_ID from JWT
USER_ID=$(echo "$JWT" | awk -F. '{print $2}' | base64 -d 2>/dev/null | jq -r '.user.id // empty')
if [ -z "$USER_ID" ]; then
  echo -e "${RED}Error: Failed to extract user ID from JWT${NC}"
  exit 1
fi
echo "User ID: $USER_ID"

# Step 2: Find or Create Company
echo "2. Finding company for user ($USER_ID)..."
COMPANY_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$COMPANY_API/companies" \
  -H "Authorization: Bearer $JWT")
COMPANY_STATUS=$(echo "$COMPANY_RESPONSE" | tail -n1)
COMPANY_BODY=$(echo "$COMPANY_RESPONSE" | sed -e '$d')

if [ "$COMPANY_STATUS" -eq 200 ] && [ "$(echo "$COMPANY_BODY" | jq '. | length')" -gt 0 ]; then
  echo "$COMPANY_BODY" | jq .
  COMPANY_ID=$(echo "$COMPANY_BODY" | jq -r '.[0]._id // .[0].id // empty')
  if [ -z "$COMPANY_ID" ]; then
    echo -e "${RED}Error: Failed to extract company ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Company found. Company ID: $COMPANY_ID, JWT: $JWT${NC}"
else
  echo -e "${RED}No company found. Creating new company...${NC}"
  CREATE_COMPANY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$COMPANY_API/companies" \
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
  CREATE_COMPANY_STATUS=$(echo "$CREATE_COMPANY_RESPONSE" | tail -n1)
  CREATE_COMPANY_BODY=$(echo "$CREATE_COMPANY_RESPONSE" | sed -e '$d')
  echo "$CREATE_COMPANY_BODY" | jq .
  handle_error "$CREATE_COMPANY_BODY" "Create Company" "$CREATE_COMPANY_STATUS"
  COMPANY_ID=$(echo "$CREATE_COMPANY_BODY" | jq -r '._id // .id // empty')
  if [ -z "$COMPANY_ID" ]; then
    echo -e "${RED}Error: Failed to extract company ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Company created successfully. Company ID: $COMPANY_ID${NC}"

  # Step 2.1: Update User with Company ID
  echo "2.1 Updating user ($USER_ID) with company ID ($COMPANY_ID)..."
  UPDATE_USER_RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$USER_API/users/$USER_ID" \
    -H "Content-Type: application/json" \
    -H "Cookie: token=$JWT" \
    -d "{\"company_id\":\"$COMPANY_ID\"}")
  UPDATE_USER_STATUS=$(echo "$UPDATE_USER_RESPONSE" | tail -n1)
  UPDATE_USER_BODY=$(echo "$UPDATE_USER_RESPONSE" | sed -e '$d')
  echo "$UPDATE_USER_BODY" | jq .
  handle_error "$UPDATE_USER_BODY" "Update User Company ID" "$UPDATE_USER_STATUS"
  NEW_JWT=$(echo "$UPDATE_USER_BODY" | jq -r '.accessToken // empty')
  if [ -z "$NEW_JWT" ]; then
    echo -e "${RED}Error: Failed to extract new JWT from update user response${NC}"
    exit 1
  fi
  JWT="$NEW_JWT"
  echo -e "${GREEN}User updated with company ID. New JWT: $JWT${NC}"
fi

# Step 3: Find or Create Product and List All Products
echo "3. Finding product for company ($COMPANY_ID)..."
PRODUCT_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$PRODUCT_API/products" \
  -H "Authorization: Bearer $JWT")
PRODUCT_STATUS=$(echo "$PRODUCT_RESPONSE" | tail -n1)
PRODUCT_BODY=$(echo "$PRODUCT_RESPONSE" | sed -e '$d')

if [ "$PRODUCT_STATUS" -eq 200 ] && [ "$(echo "$PRODUCT_BODY" | jq '. | length')" -gt 0 ]; then
  echo "$PRODUCT_BODY" | jq .
  PRODUCT_ID=$(echo "$PRODUCT_BODY" | jq -r '.[0]._id // .[0].id // empty')
  if [ -z "$PRODUCT_ID" ]; then
    echo -e "${RED}Error: Failed to extract product ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Product found. Product ID: $PRODUCT_ID, JWT: $JWT${NC}"
else
  echo -e "${RED}No product found. Creating new product...${NC}"
  CREATE_PRODUCT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PRODUCT_API/products" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"name\":\"Widget\",\"price\":49.99,\"companyId\":\"$COMPANY_ID\",\"description\":\"A cool widget\"}")
  CREATE_PRODUCT_STATUS=$(echo "$CREATE_PRODUCT_RESPONSE" | tail -n1)
  CREATE_PRODUCT_BODY=$(echo "$CREATE_PRODUCT_RESPONSE" | sed -e '$d')
  echo "$CREATE_PRODUCT_BODY" | jq .
  handle_error "$CREATE_PRODUCT_BODY" "Create Product" "$CREATE_PRODUCT_STATUS"
  PRODUCT_ID=$(echo "$CREATE_PRODUCT_BODY" | jq -r '._id // .id // empty')
  if [ -z "$PRODUCT_ID" ]; then
    echo -e "${RED}Error: Failed to extract product ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Product created successfully. Product ID: $PRODUCT_ID, JWT: $JWT${NC}"
fi

# List all products associated with company
echo "Listing all products for company ($COMPANY_ID)..."
ALL_PRODUCTS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$PRODUCT_API/products" \
  -H "Authorization: Bearer $JWT")
ALL_PRODUCTS_STATUS=$(echo "$ALL_PRODUCTS_RESPONSE" | tail -n1)
ALL_PRODUCTS_BODY=$(echo "$ALL_PRODUCTS_RESPONSE" | sed -e '$d')
if [ "$ALL_PRODUCTS_STATUS" -eq 200 ]; then
  echo "All products:"
  echo "$ALL_PRODUCTS_BODY" | jq .
else
  echo -e "${RED}Error fetching all products: HTTP $ALL_PRODUCTS_STATUS${NC}"
  exit 1
fi

# Step 4: Find or Create Order and List All Orders
echo "4. Finding order for company ($COMPANY_ID)..."
ORDER_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$ORDER_API/orders" \
  -H "Authorization: Bearer $JWT")
ORDER_STATUS=$(echo "$ORDER_RESPONSE" | tail -n1)
ORDER_BODY=$(echo "$ORDER_RESPONSE" | sed -e '$d')

if [ "$ORDER_STATUS" -eq 200 ] && [ "$(echo "$ORDER_BODY" | jq '. | length')" -gt 0 ]; then
  echo "$ORDER_BODY" | jq .
  ORDER_ID=$(echo "$ORDER_BODY" | jq -r '.[0]._id // .[0].id // empty')
  if [ -z "$ORDER_ID" ]; then
    echo -e "${RED}Error: Failed to extract order ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Order found. Order ID: $ORDER_ID, JWT: $JWT${NC}"
else
  echo -e "${RED}No order found. Creating new order...${NC}"
  CREATE_ORDER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ORDER_API/orders" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{
      \"entity\": {
        \"base_grand_total\": 49.99,
        \"grand_total\": 49.99,
        \"customer_email\": \"customer@example.com\",
        \"billing_address\": {
          \"address_type\": \"billing\",
          \"city\": \"Anytown\",
          \"country_id\": \"US\",
          \"firstname\": \"John\",
          \"lastname\": \"Doe\",
          \"postcode\": \"12345\",
          \"telephone\": \"9876543210\",
          \"street\": [\"456 Elm St\"]
        },
        \"payment\": {
          \"account_status\": \"active\",
          \"additional_information\": [\"Payment processed\"],
          \"cc_last4\": \"1234\",
          \"method\": \"credit_card\"
        },
        \"items\": [
          {
            \"sku\": \"WIDGET-001\",
            \"name\": \"Widget\",
            \"qty_ordered\": 1,
            \"price\": 49.99,
            \"row_total\": 49.99,
            \"product_id\": \"$PRODUCT_ID\"
          }
        ],
        \"company_id\": \"$COMPANY_ID\",
        \"user_id\": \"$USER_ID\"
      }
    }")
  CREATE_ORDER_STATUS=$(echo "$CREATE_ORDER_RESPONSE" | tail -n1)
  CREATE_ORDER_BODY=$(echo "$CREATE_ORDER_RESPONSE" | sed -e '$d')
  echo "$CREATE_ORDER_BODY" | jq .
  handle_error "$CREATE_ORDER_BODY" "Create Order" "$CREATE_ORDER_STATUS"
  ORDER_ID=$(echo "$CREATE_ORDER_BODY" | jq -r '._id // .id // empty')
  if [ -z "$ORDER_ID" ]; then
    echo -e "${RED}Error: Failed to extract order ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Order created successfully. Order ID: $ORDER_ID, JWT: $JWT${NC}"
fi

# List all orders associated with company
echo "Listing all orders for company ($COMPANY_ID)..."
ALL_ORDERS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$ORDER_API/orders" \
  -H "Authorization: Bearer $JWT")
ALL_ORDERS_STATUS=$(echo "$ALL_ORDERS_RESPONSE" | tail -n1)
ALL_ORDERS_BODY=$(echo "$ALL_ORDERS_RESPONSE" | sed -e '$d')
if [ "$ALL_ORDERS_STATUS" -eq 200 ]; then
  echo "All orders:"
  echo "$ALL_ORDERS_BODY" | jq .
else
  echo -e "${RED}Error fetching all orders: HTTP $ALL_ORDERS_STATUS${NC}"
  exit 1
fi

echo -e "${GREEN}All API tests for specific user completed successfully!${NC}"