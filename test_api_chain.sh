#!/bin/bash

USER_API="http://127.0.0.1:3000"
COMPANY_API="http://127.0.0.1:3001"
PRODUCT_API="http://127.0.0.1:3002"
ORDER_API="http://127.0.0.1:3003"
PASSWORD="securepassword"
PHONE_NUMBER="1234567890"
TIMESTAMP=$(date +%s)
COMPANY_EMAIL="company${TIMESTAMP}@example.com"
COMPANY_CODE="CODE${TIMESTAMP}"
COMPANY_NAME="Company User"
COMPANY_ROLE="company"

declare -A CUSTOMER_EMAILS
declare -A CUSTOMER_USER_IDS
declare -A CUSTOMER_JWTS
declare -a PRODUCT_IDS

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

check_jq() {
  if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is not installed. Please install jq to parse JSON responses.${NC}"
    echo "On Ubuntu: sudo apt-get install jq"
    exit 1
  fi
}

handle_error() {
  local response="$1"
  local step="$2"
  local status="$3"
  local message=$(echo "$response" | jq -r '.message // .error // (.errors[0].message // "Unknown error")')
  if [ "$status" -ge 400 ]; then
    echo -e "${RED}Error in $step: HTTP $status - $message${NC}"
    echo "Full Response: $response"
    exit 1
  fi
}

register_user() {
  local email="$1"
  local name="$2"
  local role="$3"
  local step="$4"
  local var_prefix="$5"
  echo "Registering user ($email) with role $role..."
  REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$PASSWORD\",\"role\":\"$role\",\"phoneNumber\":\"$PHONE_NUMBER\"}")
  REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -n1)
  REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | sed -e '$d')
  echo "$REGISTER_BODY" | jq .
  handle_error "$REGISTER_BODY" "$step" "$REGISTER_STATUS"
  local jwt=$(echo "$REGISTER_BODY" | jq -r '.accessToken // empty')
  if [ -z "$jwt" ]; then
    echo -e "${RED}Error: Failed to extract JWT from registration response for $email${NC}"
    exit 1
  fi
  local user_id=$(echo "$jwt" | awk -F. '{print $2}' | base64 -d 2>/dev/null | jq -r '.user.id // empty')
  if [ -z "$user_id" ]; then
    echo -e "${RED}Error: Failed to extract user ID from JWT for $email${NC}"
    exit 1
  fi
  if [ "$var_prefix" = "COMPANY" ]; then
    COMPANY_USER_ID=$user_id
    COMPANY_JWT=$jwt
  else
    CUSTOMER_USER_IDS[$var_prefix]=$user_id
    CUSTOMER_JWTS[$var_prefix]=$jwt
  fi
  echo -e "${GREEN}User registered successfully. User ID: $user_id, JWT: $jwt${NC}"
}

check_jq

echo "Starting API test chain..."

register_user "$COMPANY_EMAIL" "$COMPANY_NAME" "$COMPANY_ROLE" "User Registration (Company)" "COMPANY"

echo "Adding company (companyCode: $COMPANY_CODE)..."
COMPANY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$COMPANY_API/companies" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $COMPANY_JWT" \
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

echo "Updating company user ($COMPANY_USER_ID) with company ID ($COMPANY_ID)..."
UPDATE_USER_RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$USER_API/users/$COMPANY_USER_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$COMPANY_JWT" \
  -d "{\"company_id\":\"$COMPANY_ID\"}")
UPDATE_USER_STATUS=$(echo "$UPDATE_USER_RESPONSE" | tail -n1)
UPDATE_USER_BODY=$(echo "$UPDATE_USER_RESPONSE" | sed -e '$d')
echo "$UPDATE_USER_BODY" | jq .
handle_error "$UPDATE_USER_BODY" "Update Company User" "$UPDATE_USER_STATUS"
NEW_JWT=$(echo "$UPDATE_USER_BODY" | jq -r '.accessToken // empty')
if [ -z "$NEW_JWT" ]; then
  echo -e "${RED}Error: Failed to extract new JWT from update user response${NC}"
  exit 1
fi
COMPANY_JWT="$NEW_JWT"
echo -e "${GREEN}Company user updated with company ID. New JWT: $COMPANY_JWT${NC}"

echo "Adding 20 products..."
for i in $(seq 1 20); do
  PRODUCT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PRODUCT_API/products" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $COMPANY_JWT" \
    -d "{\"name\":\"Widget $i\",\"price\":$((RANDOM % 100 + 10)).99,\"companyId\":\"$COMPANY_ID\",\"description\":\"Widget $i description\",\"sku\":\"WIDGET-$i-$TIMESTAMP\"}")
  PRODUCT_STATUS=$(echo "$PRODUCT_RESPONSE" | tail -n1)
  PRODUCT_BODY=$(echo "$PRODUCT_RESPONSE" | sed -e '$d')
  echo "$PRODUCT_BODY" | jq .
  handle_error "$PRODUCT_BODY" "Add Product $i" "$PRODUCT_STATUS"
  PRODUCT_ID=$(echo "$PRODUCT_BODY" | jq -r '._id // .id // empty')
  if [ -z "$PRODUCT_ID" ]; then
    echo -e "${RED}Error: Failed to extract product ID from response for product $i${NC}"
    exit 1
  fi
  PRODUCT_IDS+=("$PRODUCT_ID")
  echo -e "${GREEN}Product $i added successfully. Product ID: $PRODUCT_ID${NC}"
done

echo "Registering 10 customer users..."
for i in $(seq 1 10); do
  CUSTOMER_EMAIL="customer${TIMESTAMP}_${i}@example.com"
  CUSTOMER_EMAILS[$i]="$CUSTOMER_EMAIL"
  register_user "$CUSTOMER_EMAIL" "Customer User $i" "customer" "User Registration (Customer $i)" "$i"
done

echo "Associating 10 customer users with company..."
for i in $(seq 1 10); do
  echo "Associating customer $i (${CUSTOMER_USER_IDS[$i]}) with company ($COMPANY_ID)..."
  ASSOCIATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$USER_API/users/associate-company" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${CUSTOMER_JWTS[$i]}" \
    -d "{\"companyId\":\"$COMPANY_ID\"}")
  ASSOCIATE_STATUS=$(echo "$ASSOCIATE_RESPONSE" | tail -n1)
  ASSOCIATE_BODY=$(echo "$ASSOCIATE_RESPONSE" | sed -e '$d')
  echo "$ASSOCIATE_BODY" | jq .
  handle_error "$ASSOCIATE_BODY" "Associate Customer $i with Company" "$ASSOCIATE_STATUS"
  NEW_JWT=$(echo "$ASSOCIATE_BODY" | jq -r '.accessToken // empty')
  if [ -n "$NEW_JWT" ]; then
    CUSTOMER_JWTS[$i]="$NEW_JWT"
    echo -e "${GREEN}Customer $i associated with company, new JWT: $NEW_JWT${NC}"
  else
    echo -e "${GREEN}Customer $i associated with company successfully${NC}"
  fi
done

echo "Placing 20 orders for each of the 10 customers..."
for i in $(seq 1 10); do
  CUSTOMER_ID=${CUSTOMER_USER_IDS[$i]}
  CUSTOMER_JWT=${CUSTOMER_JWTS[$i]}
  CUSTOMER_EMAIL=${CUSTOMER_EMAILS[$i]}

  # Check token expiry
  payload=$(echo "$CUSTOMER_JWT" | awk -F. '{print $2}' | base64 -d 2>/dev/null)
  exp=$(echo "$payload" | jq -r '.exp')
  now=$(date +%s)
  if [ "$exp" -lt "$now" ]; then
    refresh_token "${CUSTOMER_REFRESH_TOKENS[$i]}" "$i"
    CUSTOMER_JWT=${CUSTOMER_JWTS[$i]}
  fi

  for j in $(seq 1 20); do
    RANDOM_INDEX=$((RANDOM % 20))
    PRODUCT_ID=${PRODUCT_IDS[$RANDOM_INDEX]}
    PRODUCT_NAME="Widget $((RANDOM_INDEX + 1))"
    QTY=$((RANDOM % 5 + 1))
    PRICE=$(echo "scale=2; $((RANDOM % 100 + 10)).99 * $QTY" | bc)
    echo "Creating order $j for customer $i ($CUSTOMER_ID) with product $PRODUCT_ID..."
    ORDER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ORDER_API/orders" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $CUSTOMER_JWT" \
      -H "x-user-id: $CUSTOMER_ID" \
      -H "x-user-role: customer" \
      -d "{
        \"entity\": {
          \"base_grand_total\": $PRICE,
          \"grand_total\": $PRICE,
          \"customer_email\": \"$CUSTOMER_EMAIL\",
          \"customer_id\": \"$CUSTOMER_ID\",
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
              \"sku\": \"WIDGET-$((RANDOM_INDEX + 1))-$TIMESTAMP\",
              \"name\": \"$PRODUCT_NAME\",
              \"qty_ordered\": $QTY,
              \"price\": $(echo "scale=2; $PRICE / $QTY" | bc),
              \"row_total\": $PRICE,
              \"product_id\": \"$PRODUCT_ID\"
            }
          ],
          \"status_histories\": [
            {
              \"comment\": \"Order placed\",
              \"is_customer_notified\": 1,
              \"is_visible_on_front\": 1,
              \"parent_id\": 1
            }
          ],
          \"company_id\": \"$COMPANY_ID\",
          \"user_id\": \"$CUSTOMER_ID\"
        }
      }")
    ORDER_STATUS=$(echo "$ORDER_RESPONSE" | tail -n1)
    ORDER_BODY=$(echo "$ORDER_RESPONSE" | sed -e '$d')
    echo "$ORDER_BODY" | jq .
    if [ "$ORDER_STATUS" -ge 400 ]; then
      echo "Error in Create Order $j for Customer $i: HTTP $ORDER_STATUS - $ORDER_BODY"
      exit 1
    fi
    ORDER_ID=$(echo "$ORDER_BODY" | jq -r '._id // .id // empty')
    echo "Order $j created successfully for customer $i. Order ID: $ORDER_ID"
  done
done

echo -e "${GREEN}All API tests completed successfully!${NC}"