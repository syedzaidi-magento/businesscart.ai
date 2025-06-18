#!/bin/bash

# Configuration
USER_API="http://127.0.0.1:3000"
COMPANY_API="http://127.0.0.1:3001"
PRODUCT_API="http://127.0.0.1:3002"
ORDER_API="http://127.0.0.1:3003"
PASSWORD="securepassword"
PHONE_NUMBER="1234567890"
COMPANY_CODE="CODE12345"
COMPANY_ID=""

# User configurations
declare -A USERS=(
  ["company"]="company@example.com"
  ["customer"]="customer@example.com"
  ["admin"]="admin@example.com"
)
declare -A NAMES=(
  ["company"]="Company User"
  ["customer"]="Customer User"
  ["admin"]="Admin User"
)
declare -A ROLES=(
  ["company"]="company"
  ["customer"]="customer"
  ["admin"]="admin"
)
declare -A JWTS
declare -A USER_IDS
# Arrays for new customer users
CUSTOMER_COUNT=20
declare -A NEW_CUSTOMER_EMAILS
declare -A NEW_CUSTOMER_NAMES
declare -A NEW_CUSTOMER_IDS
declare -A NEW_CUSTOMER_JWTS

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

# Function to login or register user
login_or_register() {
  local role="$1"
  local email="${USERS[$role]}"
  local name="${NAMES[$role]}"
  local user_role="${ROLES[$role]}"

  echo "1. Attempting to login $role user ($email)..."
  LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\"}")
  LOGIN_STATUS=$(echo "$LOGIN_RESPONSE" | tail -n1)
  LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed -e '$d')

  if [ "$LOGIN_STATUS" -eq 200 ]; then
    echo "$LOGIN_BODY" | jq .
    JWTS[$role]=$(echo "$LOGIN_BODY" | jq -r '.accessToken // empty')
    if [ -z "${JWTS[$role]}" ]; then
      echo -e "${RED}Error: Failed to extract JWT from login response for $role${NC}"
      exit 1
    fi
    echo -e "${GREEN}Login successful for $role. JWT: ${JWTS[$role]}${NC}"
  else
    echo -e "${RED}Login failed for $role (HTTP $LOGIN_STATUS). Attempting to register...${NC}"
    REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/register" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$PASSWORD\",\"role\":\"$user_role\",\"phoneNumber\":\"$PHONE_NUMBER\"}")
    REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -n1)
    REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | sed -e '$d')
    echo "$REGISTER_BODY" | jq .
    handle_error "$REGISTER_BODY" "$role User Registration" "$REGISTER_STATUS"
    JWTS[$role]=$(echo "$REGISTER_BODY" | jq -r '.accessToken // empty')
    if [ -z "${JWTS[$role]}" ]; then
      echo -e "${RED}Error: Failed to extract JWT from registration response for $role${NC}"
      exit 1
    fi
    echo -e "${GREEN}$role user registered successfully. JWT: ${JWTS[$role]}${NC}"
  fi

  # Extract USER_ID from JWT
  USER_IDS[$role]=$(echo "${JWTS[$role]}" | awk -F. '{print $2}' | base64 -d 2>/dev/null | jq -r '.user.id // empty')
  if [ -z "${USER_IDS[$role]}" ]; then
    echo -e "${RED}Error: Failed to extract user ID from JWT for $role${NC}"
    exit 1
  fi
  echo "$role User ID: ${USER_IDS[$role]}"
}

# Check for jq
check_jq

echo "Starting API test chain for company, customer, and admin users..."

# Process Company User
echo "=== Testing Company User ==="
login_or_register "company"

# Step 2: Find or Create Company
echo "2. Finding company for company user (${USER_IDS[company]})..."
COMPANY_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$COMPANY_API/companies" \
  -H "Authorization: Bearer ${JWTS[company]}")
COMPANY_STATUS=$(echo "$COMPANY_RESPONSE" | tail -n1)
COMPANY_BODY=$(echo "$COMPANY_RESPONSE" | sed -e '$d')

if [ "$COMPANY_STATUS" -eq 200 ] && [ "$(echo "$COMPANY_BODY" | jq '. | length')" -gt 0 ]; then
  echo "$COMPANY_BODY" | jq .
  COMPANY_ID=$(echo "$COMPANY_BODY" | jq -r '.[0]._id // .[0].id // empty')
  if [ -z "$COMPANY_ID" ]; then
    echo -e "${RED}Error: Failed to extract company ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Company found. Company ID: $COMPANY_ID${NC}"
else
  echo -e "${RED}No company found. Creating new company...${NC}"
  CREATE_COMPANY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$COMPANY_API/companies" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JWTS[company]}" \
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
  echo "2.1 Updating company user (${USER_IDS[company]}) with company ID ($COMPANY_ID)..."
  UPDATE_USER_RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$USER_API/users/${USER_IDS[company]}" \
    -H "Content-Type: application/json" \
    -H "Cookie: token=${JWTS[company]}" \
    -d "{\"company_id\":\"$COMPANY_ID\"}")
  UPDATE_USER_STATUS=$(echo "$UPDATE_USER_RESPONSE" | tail -n1)
  UPDATE_USER_BODY=$(echo "$UPDATE_USER_RESPONSE" | sed -e '$d')
  echo "$UPDATE_USER_BODY" | jq .
  handle_error "$UPDATE_USER_BODY" "Update Company User Company ID" "$UPDATE_USER_STATUS"
  JWTS[company]=$(echo "$UPDATE_USER_BODY" | jq -r '.accessToken // empty')
  if [ -z "${JWTS[company]}" ]; then
    echo -e "${RED}Error: Failed to extract new JWT from update user response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Company user updated with company ID. New JWT: ${JWTS[company]}${NC}"
fi

# Step 3: Find or Create Product and List All Products
echo "3. Finding product for company ($COMPANY_ID)..."
PRODUCT_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$PRODUCT_API/products" \
  -H "Authorization: Bearer ${JWTS[company]}")
PRODUCT_STATUS=$(echo "$PRODUCT_RESPONSE" | tail -n1)
PRODUCT_BODY=$(echo "$PRODUCT_RESPONSE" | sed -e '$d')

if [ "$PRODUCT_STATUS" -eq 200 ] && [ "$(echo "$PRODUCT_BODY" | jq '. | length')" -gt 0 ]; then
  echo "$PRODUCT_BODY" | jq .
  PRODUCT_ID=$(echo "$PRODUCT_BODY" | jq -r '.[0]._id // .[0].id // empty')
  if [ -z "$PRODUCT_ID" ]; then
    echo -e "${RED}Error: Failed to extract product ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Product found. Product ID: $PRODUCT_ID${NC}"
else
  echo -e "${RED}No product found. Creating new product...${NC}"
  CREATE_PRODUCT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PRODUCT_API/products" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JWTS[company]}" \
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
  echo -e "${GREEN}Product created successfully. Product ID: $PRODUCT_ID${NC}"
fi

# List all products for company
echo "Listing all products for company ($COMPANY_ID)..."
ALL_PRODUCTS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$PRODUCT_API/products" \
  -H "Authorization: Bearer ${JWTS[company]}")
ALL_PRODUCTS_STATUS=$(echo "$ALL_PRODUCTS_RESPONSE" | tail -n1)
ALL_PRODUCTS_BODY=$(echo "$ALL_PRODUCTS_RESPONSE" | sed -e '$d')
if [ "$ALL_PRODUCTS_STATUS" -eq 200 ]; then
  echo "All products for company:"
  echo "$ALL_PRODUCTS_BODY" | jq .
else
  echo -e "${RED}Error fetching all products for company: HTTP $ALL_PRODUCTS_STATUS${NC}"
  exit 1
fi

# Step 4: Find or Create Order and List All Orders
echo "4. Finding order for company ($COMPANY_ID)..."
ORDER_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$ORDER_API/orders" \
  -H "Authorization: Bearer ${JWTS[company]}")
ORDER_STATUS=$(echo "$ORDER_RESPONSE" | tail -n1)
ORDER_BODY=$(echo "$ORDER_RESPONSE" | sed -e '$d')

if [ "$ORDER_STATUS" -eq 200 ] && [ "$(echo "$ORDER_BODY" | jq '. | length')" -gt 0 ]; then
  echo "$ORDER_BODY" | jq .
  ORDER_ID=$(echo "$ORDER_BODY" | jq -r '.[0]._id // .[0].id // empty')
  if [ -z "$ORDER_ID" ]; then
    echo -e "${RED}Error: Failed to extract order ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Order found. Order ID: $ORDER_ID${NC}"
else
  echo -e "${RED}No order found. Creating new order...${NC}"
  CREATE_ORDER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ORDER_API/orders" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JWTS[company]}" \
    -d "{
      \"entity\": {
        \"base_grand_total\": 49.99,
        \"grand_total\": 49.99,
        \"customer_email\": \"${USERS[customer]}\",
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
        \"user_id\": \"${USER_IDS[company]}\"
      }
    }")
  CREATE_ORDER_STATUS=$(echo "$CREATE_ORDER_RESPONSE" | tail -n1)
  CREATE_ORDER_BODY=$(echo "$CREATE_ORDER_RESPONSE" | sed -e '$d')
  echo "$CREATE_ORDER_BODY" | jq .
  handle_error "$CREATE_ORDER_BODY" "Create Order for Company" "$CREATE_ORDER_STATUS"
  ORDER_ID=$(echo "$CREATE_ORDER_BODY" | jq -r '._id // .id // empty')
  if [ -z "$ORDER_ID" ]; then
    echo -e "${RED}Error: Failed to extract order ID from response${NC}"
    exit 1
  fi
  echo -e "${GREEN}Order created successfully. Order ID: $ORDER_ID${NC}"
fi

# List all orders for company
echo "Listing all orders for company ($COMPANY_ID)..."
ALL_ORDERS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$ORDER_API/orders" \
  -H "Authorization: Bearer ${JWTS[company]}")
ALL_ORDERS_STATUS=$(echo "$ALL_ORDERS_RESPONSE" | tail -n1)
ALL_ORDERS_BODY=$(echo "$ALL_ORDERS_RESPONSE" | sed -e '$d')
if [ "$ALL_ORDERS_STATUS" -eq 200 ]; then
  echo "All orders for company:"
  echo "$ALL_ORDERS_BODY" | jq .
else
  echo -e "${RED}Error fetching all orders for company: HTTP $ALL_ORDERS_STATUS${NC}"
  exit 1
fi

# Process Customer User
echo "=== Testing Customer User ==="
login_or_register "customer"

# Step 2: Update Existing Customer
echo "2. Updating existing customer user (${USER_IDS[customer]})..."
UPDATE_CUSTOMER_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$USER_API/users/${USER_IDS[customer]}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWTS[customer]}" \
  -d "{\"name\":\"Updated Customer User\",\"phoneNumber\":\"9876543210\"}")
UPDATE_CUSTOMER_STATUS=$(echo "$UPDATE_CUSTOMER_RESPONSE" | tail -n1)
UPDATE_CUSTOMER_BODY=$(echo "$UPDATE_CUSTOMER_RESPONSE" | sed -e '$d')
echo "$UPDATE_CUSTOMER_BODY" | jq .
handle_error "$UPDATE_CUSTOMER_BODY" "Update Existing Customer" "$UPDATE_CUSTOMER_STATUS"
JWTS[customer]=$(echo "$UPDATE_CUSTOMER_BODY" | jq -r '.accessToken // empty')
if [ -z "${JWTS[customer]}" ]; then
  echo -e "${RED}Error: Failed to extract new JWT from update customer response${NC}"
  exit 1
fi
echo -e "${GREEN}Existing customer updated successfully. New JWT: ${JWTS[customer]}${NC}"

# Step 3: Associate Customer with Company
echo "3. Associating customer user (${USER_IDS[customer]}) with company ($COMPANY_ID)..."
ASSOCIATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/associate-company" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWTS[customer]}" \
  -d "{\"companyId\":\"$COMPANY_ID\"}")
ASSOCIATE_STATUS=$(echo "$ASSOCIATE_RESPONSE" | tail -n1)
ASSOCIATE_BODY=$(echo "$ASSOCIATE_RESPONSE" | sed -e '$d')
echo "$ASSOCIATE_BODY" | jq .
handle_error "$ASSOCIATE_BODY" "Associate Customer with Company" "$ASSOCIATE_STATUS"
JWTS[customer]=$(echo "$ASSOCIATE_BODY" | jq -r '.accessToken // empty')
if [ -z "${JWTS[customer]}" ]; then
  echo -e "${RED}Error: Failed to extract new JWT from associate company response${NC}"
  exit 1
fi
echo -e "${GREEN}Customer associated with company successfully. New JWT: ${JWTS[customer]}${NC}"

# Step 4: Create and List Orders for Customer
echo "4. Creating order for customer (${USER_IDS[customer]})..."
CREATE_CUSTOMER_ORDER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ORDER_API/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWTS[customer]}" \
  -d "{
    \"entity\": {
      \"base_grand_total\": 49.99,
      \"grand_total\": 49.99,
      \"customer_email\": \"${USERS[customer]}\",
      \"billing_address\": {
        \"address_type\": \"billing\",
        \"city\": \"Anytown\",
        \"country_id\": \"US\",
        \"firstname\": \"Jane\",
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
      \"user_id\": \"${USER_IDS[customer]}\"
    }
  }")
CREATE_CUSTOMER_ORDER_STATUS=$(echo "$CREATE_CUSTOMER_ORDER_RESPONSE" | tail -n1)
CREATE_CUSTOMER_ORDER_BODY=$(echo "$CREATE_CUSTOMER_ORDER_RESPONSE" | sed -e '$d')
echo "$CREATE_CUSTOMER_ORDER_BODY" | jq .
handle_error "$CREATE_CUSTOMER_ORDER_BODY" "Create Order for Customer" "$CREATE_CUSTOMER_ORDER_STATUS"
CUSTOMER_ORDER_ID=$(echo "$CREATE_CUSTOMER_ORDER_BODY" | jq -r '._id // .id // empty')
if [ -z "$CUSTOMER_ORDER_ID" ]; then
  echo -e "${RED}Error: Failed to extract order ID from response${NC}"
  exit 1
fi
echo -e "${GREEN}Order created successfully for customer. Order ID: $CUSTOMER_ORDER_ID${NC}"

# List all orders for customer
echo "Listing all orders for customer (${USER_IDS[customer]})..."
ALL_CUSTOMER_ORDERS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$ORDER_API/orders" \
  -H "Authorization: Bearer ${JWTS[customer]}")
ALL_CUSTOMER_ORDERS_STATUS=$(echo "$ALL_CUSTOMER_ORDERS_RESPONSE" | tail -n1)
ALL_CUSTOMER_ORDERS_BODY=$(echo "$ALL_CUSTOMER_ORDERS_RESPONSE" | sed -e '$d')
if [ "$ALL_CUSTOMER_ORDERS_STATUS" -eq 200 ]; then
  echo "All orders for customer:"
  echo "$ALL_CUSTOMER_ORDERS_BODY" | jq .
else
  echo -e "${RED}Error fetching all orders for customer: HTTP $ALL_CUSTOMER_ORDERS_STATUS${NC}"
  exit 1
fi

# Step 5: Create and Process 20 New Customer Users
echo "=== Creating and Processing 20 New Customer Users ==="
for ((i=1; i<=CUSTOMER_COUNT; i++)); do
  NEW_CUSTOMER_EMAILS[$i]="customer$i@example.com"
  NEW_CUSTOMER_NAMES[$i]="Customer User $i"
  echo "Processing new customer $i (${NEW_CUSTOMER_EMAILS[$i]})..."

  # Register new customer
  echo "5.$i.1 Registering new customer user (${NEW_CUSTOMER_EMAILS[$i]})..."
  REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${NEW_CUSTOMER_NAMES[$i]}\",\"email\":\"${NEW_CUSTOMER_EMAILS[$i]}\",\"password\":\"$PASSWORD\",\"role\":\"customer\",\"phoneNumber\":\"$PHONE_NUMBER\"}")
  REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -n1)
  REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | sed -e '$d')
  echo "$REGISTER_BODY" | jq .
  handle_error "$REGISTER_BODY" "Register New Customer $i" "$REGISTER_STATUS"
  NEW_CUSTOMER_JWTS[$i]=$(echo "$REGISTER_BODY" | jq -r '.accessToken // empty')
  if [ -z "${NEW_CUSTOMER_JWTS[$i]}" ]; then
    echo -e "${RED}Error: Failed to extract JWT from registration response for customer $i${NC}"
    exit 1
  fi
  NEW_CUSTOMER_IDS[$i]=$(echo "${NEW_CUSTOMER_JWTS[$i]}" | awk -F. '{print $2}' | base64 -d 2>/dev/null | jq -r '.user.id // empty')
  if [ -z "${NEW_CUSTOMER_IDS[$i]}" ]; then
    echo -e "${RED}Error: Failed to extract user ID from JWT for customer $i${NC}"
    exit 1
  fi
  echo -e "${GREEN}New customer $i registered successfully. User ID: ${NEW_CUSTOMER_IDS[$i]}, JWT: ${NEW_CUSTOMER_JWTS[$i]}${NC}"

  # Associate new customer with company
  echo "5.$i.2 Associating new customer user (${NEW_CUSTOMER_IDS[$i]}) with company ($COMPANY_ID)..."
  ASSOCIATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/associate-company" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${NEW_CUSTOMER_JWTS[$i]}" \
    -d "{\"companyId\":\"$COMPANY_ID\"}")
  ASSOCIATE_STATUS=$(echo "$ASSOCIATE_RESPONSE" | tail -n1)
  ASSOCIATE_BODY=$(echo "$ASSOCIATE_RESPONSE" | sed -e '$d')
  echo "$ASSOCIATE_BODY" | jq .
  handle_error "$ASSOCIATE_BODY" "Associate New Customer $i with Company" "$ASSOCIATE_STATUS"
  NEW_CUSTOMER_JWTS[$i]=$(echo "$ASSOCIATE_BODY" | jq -r '.accessToken // empty')
  if [ -z "${NEW_CUSTOMER_JWTS[$i]}" ]; then
    echo -e "${RED}Error: Failed to extract new JWT from associate company response for customer $i${NC}"
    exit 1
  fi
  echo -e "${GREEN}New customer $i associated with company successfully. New JWT: ${NEW_CUSTOMER_JWTS[$i]}${NC}"

  # Create order for new customer
  echo "5.$i.3 Creating order for new customer (${NEW_CUSTOMER_IDS[$i]})..."
  CREATE_NEW_CUSTOMER_ORDER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ORDER_API/orders" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${NEW_CUSTOMER_JWTS[$i]}" \
    -d "{
      \"entity\": {
        \"base_grand_total\": 49.99,
        \"grand_total\": 49.99,
        \"customer_email\": \"${NEW_CUSTOMER_EMAILS[$i]}\",
        \"billing_address\": {
          \"address_type\": \"billing\",
          \"city\": \"Anytown\",
          \"country_id\": \"US\",
          \"firstname\": \"Customer\",
          \"lastname\": \"$i\",
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
        \"user_id\": \"${NEW_CUSTOMER_IDS[$i]}\"
      }
    }")
  CREATE_NEW_CUSTOMER_ORDER_STATUS=$(echo "$CREATE_NEW_CUSTOMER_ORDER_RESPONSE" | tail -n1)
  CREATE_NEW_CUSTOMER_ORDER_BODY=$(echo "$CREATE_NEW_CUSTOMER_ORDER_RESPONSE" | sed -e '$d')
  echo "$CREATE_NEW_CUSTOMER_ORDER_BODY" | jq .
  handle_error "$CREATE_NEW_CUSTOMER_ORDER_BODY" "Create Order for New Customer $i" "$CREATE_NEW_CUSTOMER_ORDER_STATUS"
  NEW_CUSTOMER_ORDER_ID=$(echo "$CREATE_NEW_CUSTOMER_ORDER_BODY" | jq -r '._id // .id // empty')
  if [ -z "$NEW_CUSTOMER_ORDER_ID" ]; then
    echo -e "${RED}Error: Failed to extract order ID from response for customer $i${NC}"
    exit 1
  fi
  echo -e "${GREEN}Order created successfully for new customer $i. Order ID: $NEW_CUSTOMER_ORDER_ID${NC}"
done

# Process Admin User
echo "=== Testing Admin User ==="
login_or_register "admin"

# Step 2: List Products for Admin
echo "2. Listing products for admin (${USER_IDS[admin]})..."
ADMIN_PRODUCTS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$PRODUCT_API/products" \
  -H "Authorization: Bearer ${JWTS[admin]}")
ADMIN_PRODUCTS_STATUS=$(echo "$ADMIN_PRODUCTS_RESPONSE" | tail -n1)
ADMIN_PRODUCTS_BODY=$(echo "$ADMIN_PRODUCTS_RESPONSE" | sed -e '$d')
if [ "$ADMIN_PRODUCTS_STATUS" -eq 200 ]; then
  echo "Products for admin:"
  echo "$ADMIN_PRODUCTS_BODY" | jq .
else
  echo -e "${RED}Error fetching products for admin: HTTP $ADMIN_PRODUCTS_STATUS${NC}"
  exit 1
fi

# Step 3: List Orders for Admin
echo "3. Listing orders for admin (${USER_IDS[admin]})..."
ADMIN_ORDERS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$ORDER_API/orders" \
  -H "Authorization: Bearer ${JWTS[admin]}")
ADMIN_ORDERS_STATUS=$(echo "$ADMIN_ORDERS_RESPONSE" | tail -n1)
ADMIN_ORDERS_BODY=$(echo "$ADMIN_ORDERS_RESPONSE" | sed -e '$d')
if [ "$ADMIN_ORDERS_STATUS" -eq 200 ]; then
  echo "All orders for admin:"
  echo "$ADMIN_ORDERS_BODY" | jq .
else
  echo -e "${RED}Error fetching all orders for admin: HTTP $ADMIN_ORDERS_STATUS${NC}"
  exit 1
fi

echo -e "${GREEN}All API tests for company, customer, and admin users completed successfully!${NC}"