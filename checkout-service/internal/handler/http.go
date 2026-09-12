package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang-jwt/jwt/v5"
	"github.com/syed/businesscart/checkout-service/internal/cart"
	mailer "github.com/syed/businesscart/checkout-service/internal/email"
	"github.com/syed/businesscart/checkout-service/internal/gateway"
	"github.com/syed/businesscart/checkout-service/internal/order"
	"github.com/syed/businesscart/checkout-service/internal/promotion"
	"github.com/syed/businesscart/checkout-service/internal/quote"
	"github.com/syed/businesscart/checkout-service/internal/statement"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// CheckoutRequest represents the request body for a checkout.
type CheckoutRequest struct {
	CompanyID    string          `json:"companyId"`
	PromoCode    string          `json:"promoCode,omitempty"`
	PaymentToken string          `json:"paymentToken"`
	Items        []cart.CartItem `json:"items"`
}

// CartItemRequest represents the request body for adding/updating a cart item.
// It also carries the Saved Cart (Requisition List) actions, which reuse this endpoint.
type CartItemRequest struct {
	Entity          cart.CartItem   `json:"entity"`
	SellerID        string          `json:"sellerId,omitempty"`
	SavedListAction string          `json:"savedListAction,omitempty"` // save | load | delete
	SavedListName   string          `json:"savedListName,omitempty"`
	Items           []cart.CartItem `json:"items,omitempty"` // load: frontend-resolved fresh items
}

// CustomerConfiguration represents a customer-specific configuration.
type CustomerConfiguration struct {
	CompanyID             string   `json:"company_id"`
	DiscountPercentage    *float64 `json:"discount,omitempty"`
	PaymentMethods        []string `json:"paymentMethods,omitempty"`
	DeliveryMethods       []string `json:"deliveryMethods,omitempty"`
	ShippingOutOptions    []string `json:"shippingOutOptions,omitempty"`
	QuotesAllowed         *bool    `json:"quotesAllowed,omitempty"`
	CouponsEnabled        *bool    `json:"couponsEnabled,omitempty"`
	CreditLimit           *float64 `json:"creditLimit,omitempty"`
	MinOrderAmountLimit   *float64 `json:"minOrderAmountLimit,omitempty"`
	MaxOrderAmountLimit   *float64 `json:"maxOrderAmountLimit,omitempty"`
	MinOrderQuantityLimit *float64 `json:"minOrderQuantityLimit,omitempty"`
	MaxOrderQuantityLimit *float64 `json:"maxOrderQuantityLimit,omitempty"`
	MonthlyOrderLimit     *float64 `json:"monthlyOrderLimit,omitempty"`
	YearlyOrderLimit      *float64 `json:"yearlyOrderLimit,omitempty"`
	TaxableGoods          *bool    `json:"taxableGoods,omitempty"`
	TaxRate               *float64 `json:"taxRate,omitempty"`
	ShippingRate          *float64 `json:"shippingRate,omitempty"`
	LeadTime              *float64 `json:"leadTime,omitempty"`
}

// PatchRequest defines the structure for all PATCH operations
type PatchRequest struct {
	Operation string          `json:"operation"`
	Value     json.RawMessage `json:"value"`
}

// LambdaHandler handles AWS Lambda requests.
type LambdaHandler struct {
	requestOrigin    string
	requestUserEmail string // set per-request from JWT
	cartService      *cart.Service
	quoteService     *quote.Service
	orderService     *order.Service
	statementService *statement.Service
	gatewayStore     *gateway.Store
	gatewayRegistry  *gateway.Registry
	promotionService *promotion.Service
	jwtSecret        string
	apiBaseURL       string
	emailSender      mailer.Sender
}

// NewLambdaHandler creates a new LambdaHandler.
func NewLambdaHandler(cartService *cart.Service, quoteService *quote.Service, orderService *order.Service, statementService *statement.Service, gatewayStore *gateway.Store, gatewayRegistry *gateway.Registry, promotionService *promotion.Service, jwtSecret, apiBaseURL string, emailSender mailer.Sender) *LambdaHandler {
	return &LambdaHandler{
		cartService:      cartService,
		quoteService:     quoteService,
		orderService:     orderService,
		statementService: statementService,
		gatewayStore:     gatewayStore,
		gatewayRegistry:  gatewayRegistry,
		promotionService: promotionService,
		jwtSecret:        jwtSecret,
		apiBaseURL:       apiBaseURL,
		emailSender:      emailSender,
	}
}

// HandleRequest processes an API Gateway Proxy Request.
func (h *LambdaHandler) HandleRequest(request events.APIGatewayProxyRequest) (resp events.APIGatewayProxyResponse, err error) {
	// Panic recover with admin alert. Without this, a panic at checkout time
	// (the highest-stakes path in the system) becomes a silent 500 from API
	// Gateway. NotifyAdmin is dedup'd so a repeating panic does not flood.
	defer func() {
		if r := recover(); r != nil {
			// Subject keyed on Resource (route template like /checkout/orders/{orderId}),
			// not Path (contains unique order IDs). Without this, the dedup map
			// grows once per unique URL and leaks memory over Lambda container
			// lifetime. Body keeps the actual path for debugging.
			body := fmt.Sprintf("path=%s method=%s\npanic=%v", request.Path, request.HTTPMethod, r)
			mailer.NotifyAdmin(h.emailSender, "panic in checkout-service: "+request.Resource, body)
			log.Printf("PANIC in HandleRequest path=%s: %v", request.Path, r)
			resp = h.errorResponse(http.StatusInternalServerError, "Internal server error")
			err = nil
		}
	}()

	h.requestOrigin = request.Headers["origin"]
	if h.requestOrigin == "" {
		h.requestOrigin = request.Headers["Origin"]
	}

	// Handle preflight OPTIONS requests
	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    corsHeaders(h.requestOrigin),
		}, nil
	}

	log.Printf("Received event: %+v", request)

	// Handle payment endpoints BEFORE JWT validation (browser redirects, no auth)
	if strings.HasPrefix(request.Path, "/checkout/payment-return") {
		return h.handlePaymentReturnRequest(request)
	}

	// Validate JWT token
	authHeader, ok := request.Headers["Authorization"]
	if !ok {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized: Missing token"), nil
	}

	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(h.jwtSecret), nil
	})

	if err != nil || !token.Valid {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized: Invalid token"), nil
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized: Invalid token claims"), nil
	}

	userClaim, ok := claims["user"].(map[string]interface{})
	if !ok {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized: User claim is not a map"), nil
	}

	// The organisation this caller acts within (Roadmap #21c). Seller-scoped
	// records are keyed by the ROOT account's id, so authorisation compares
	// against this rather than the caller's own id — otherwise a second account
	// in the same organisation is locked out of its own company's data. Older
	// tokens carry no org_id, and an account with no parent resolves to its own
	// id, so this falls back to accountID and behaves exactly as before.
	orgID, _ := userClaim["org_id"].(string)

	accountID, ok := userClaim["id"].(string)
	if !ok {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized: User ID missing"), nil
	}
	if orgID == "" {
		orgID = accountID
	}

	role, ok := userClaim["role"].(string)
	if !ok {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized: Role missing"), nil
	}

	// Capture email for outbound notifications. Optional — not all tokens have it.
	h.requestUserEmail, _ = userClaim["email"].(string)

	// Add this block to safely extract associate_company_ids
	var associateCompanyIDs []string
	if ids, ok := userClaim["associate_company_ids"].([]interface{}); ok {
		for _, id := range ids {
			if idStr, ok := id.(string); ok {
				associateCompanyIDs = append(associateCompanyIDs, idStr)
			}
		}
	}

	// Add this block to safely extract configurations
	var configurations []CustomerConfiguration
	if configs, ok := userClaim["configurations"].([]interface{}); ok {
		for _, config := range configs {
			if configMap, ok := config.(map[string]interface{}); ok {
				var customerConfig CustomerConfiguration
				if companyID, ok := configMap["company_id"].(string); ok {
					customerConfig.CompanyID = companyID
				}
				if discount, ok := configMap["discount"].(float64); ok {
					customerConfig.DiscountPercentage = &discount
				}
				if pms, ok := configMap["paymentMethods"].([]interface{}); ok {
					for _, pm := range pms {
						if pmStr, ok := pm.(string); ok {
							customerConfig.PaymentMethods = append(customerConfig.PaymentMethods, pmStr)
						}
					}
				}
				if dms, ok := configMap["deliveryMethods"].([]interface{}); ok {
					for _, dm := range dms {
						if dmStr, ok := dm.(string); ok {
							customerConfig.DeliveryMethods = append(customerConfig.DeliveryMethods, dmStr)
						}
					}
				}
				if sos, ok := configMap["shippingOutOptions"].([]interface{}); ok {
					for _, so := range sos {
						if soStr, ok := so.(string); ok {
							customerConfig.ShippingOutOptions = append(customerConfig.ShippingOutOptions, soStr)
						}
					}
				}
				if qa, ok := configMap["quotesAllowed"].(bool); ok {
					customerConfig.QuotesAllowed = &qa
				}
				if v, ok := configMap["creditLimit"].(float64); ok {
					customerConfig.CreditLimit = &v
				}
				if v, ok := configMap["minOrderAmountLimit"].(float64); ok {
					customerConfig.MinOrderAmountLimit = &v
				}
				if v, ok := configMap["maxOrderAmountLimit"].(float64); ok {
					customerConfig.MaxOrderAmountLimit = &v
				}
				if v, ok := configMap["minOrderQuantityLimit"].(float64); ok {
					customerConfig.MinOrderQuantityLimit = &v
				}
				if v, ok := configMap["maxOrderQuantityLimit"].(float64); ok {
					customerConfig.MaxOrderQuantityLimit = &v
				}
				if v, ok := configMap["monthlyOrderLimit"].(float64); ok {
					customerConfig.MonthlyOrderLimit = &v
				}
				if v, ok := configMap["yearlyOrderLimit"].(float64); ok {
					customerConfig.YearlyOrderLimit = &v
				}
				if v, ok := configMap["taxableGoods"].(bool); ok {
					customerConfig.TaxableGoods = &v
				}
				if v, ok := configMap["couponsEnabled"].(bool); ok {
					customerConfig.CouponsEnabled = &v
				}
				if v, ok := configMap["taxRate"].(float64); ok {
					customerConfig.TaxRate = &v
				}
				if v, ok := configMap["shippingRate"].(float64); ok {
					customerConfig.ShippingRate = &v
				}
				if v, ok := configMap["leadTime"].(float64); ok {
					customerConfig.LeadTime = &v
				}
				configurations = append(configurations, customerConfig)
			}
		}
	}

	// The organisation's own approval policy (Roadmap #21), carried once rather
	// than once per supplier. account-service emits it for company and customer
	// roles only, so a b2c storefront shopper's token carries nothing here.
	approval := approvalPolicyFromClaim(userClaim)

	// Seniority inside the caller's organisation (Roadmap #35g). Absent on
	// platform-admin and storefront tokens, where restricting would be wrong.
	orgRole, _ := userClaim["org_role"].(string)

	log.Printf("Account ID: %s, Role: %s, Associate Company IDs: %v", accountID, role, associateCompanyIDs)

	if strings.HasPrefix(request.Path, "/checkout/cart") {
		return h.handleCartRequest(request, accountID, role, associateCompanyIDs)
	} else if strings.HasPrefix(request.Path, "/checkout/quotes") {
		return h.handleQuoteRequest(request, accountID, orgID, role, configurations, approval)
	} else if strings.HasPrefix(request.Path, "/checkout/orders") {
		return h.handleOrderRequest(request, accountID, orgID, role, orgRole, configurations, approval)
	} else if strings.HasPrefix(request.Path, "/checkout/statements") {
		return h.handleStatementsRequest(request, accountID, orgID, role, orgRole)
	} else if strings.HasPrefix(request.Path, "/checkout/gateways") {
		return h.handleGatewayRequest(request, accountID, orgID, role, orgRole)
	}

	return h.errorResponse(http.StatusNotFound, "Route not found"), nil
}

func (h *LambdaHandler) handleOrderRequest(request events.APIGatewayProxyRequest, accountID, orgID, role, orgRole string, configurations []CustomerConfiguration, approval resolvedApprovalPolicy) (events.APIGatewayProxyResponse, error) {
	parts := strings.Split(request.Path, "/")
	if request.HTTPMethod == "GET" && len(parts) == 4 && parts[3] == "export" {
		return h.handleOrdersExport(request, accountID, orgID, role)
	}
	if request.HTTPMethod == "GET" && len(parts) == 4 && parts[3] == "statement" {
		return h.handleGetStatementRequest(request, accountID, orgID, role, orgRole)
	}
	if request.HTTPMethod == "POST" && len(parts) == 5 && parts[3] == "statement" && parts[4] == "send" {
		return h.handleSendStatementRequest(request, accountID, orgID, role, orgRole)
	}
	// Guard: any other request under /statement is a client mistake — refuse
	// rather than fall through to handlePlaceOrderRequest (which would parse
	// the body as an order checkout).
	if len(parts) >= 4 && parts[3] == "statement" {
		return h.errorResponse(http.StatusMethodNotAllowed, "Use GET /checkout/orders/statement or POST /checkout/orders/statement/send"), nil
	}
	if request.HTTPMethod == "POST" {
		return h.handlePlaceOrderRequest(request, accountID, role, configurations, approval)
	}
	if request.HTTPMethod == "GET" {
		return h.handleGetOrdersRequest(request, accountID, orgID, role)
	}
	if request.HTTPMethod == "DELETE" && len(parts) == 4 { // /checkout/orders/{orderId}
		return h.handleDeleteOrderRequest(parts[3], role)
	}
	if request.HTTPMethod == "PUT" && len(parts) == 4 { // /checkout/orders/{orderId}
		return h.handleUpdateOrderRequest(parts[3], request, accountID, orgID, role)
	}
	if request.HTTPMethod == "POST" && len(parts) == 5 && parts[4] == "request-review" { // /checkout/orders/{orderId}/request-review
		return h.handleRequestReviewRequest(parts[3], accountID, orgID, role)
	}
	return h.errorResponse(http.StatusNotFound, "Route not found"), nil
}

func (h *LambdaHandler) handleQuoteRequest(request events.APIGatewayProxyRequest, accountID, orgID string, role string, configurations []CustomerConfiguration, approval resolvedApprovalPolicy) (events.APIGatewayProxyResponse, error) {
	parts := strings.Split(request.Path, "/")
	if request.HTTPMethod == "POST" {
		return h.handleCreateQuoteRequest(request, accountID, orgID, role, configurations, approval)
	}
	if request.HTTPMethod == "GET" {
		if len(parts) == 3 { // /checkout/quotes
			return h.handleGetMyQuotesRequest(request, accountID, orgID, role)
		}
		if len(parts) == 4 { // /checkout/quotes/{quoteId}
			quoteId := parts[3]
			return h.handleGetQuoteRequest(request, accountID, orgID, role, quoteId)
		}
	}
	if request.HTTPMethod == "PATCH" {
		if len(parts) == 4 { // /checkout/quotes/{quoteId}
			quoteId := parts[3]
			return h.handlePatchQuoteRequest(request, accountID, orgID, role, approval, quoteId)
		}
	}
	return h.errorResponse(http.StatusNotFound, "Route not found"), nil
}

// applyDiscountRequest defines the structure for applying a discount to a quote.
type applyDiscountRequest struct {
	DiscountPercentage float64 `json:"discountPercentage"`
}

// sellerUpdateRequest defines the structure for a seller updating a quote.
type sellerUpdateRequest struct {
	Items           []quote.ItemUpdate `json:"items,omitempty"`
	NewShippingCost *float64           `json:"newShippingCost,omitempty"`
	Notes           *string            `json:"notes,omitempty"`
}

// customerProposeRequest defines the structure for a customer proposing changes to a quote.
type customerProposeRequest struct {
	Changes []quote.ProposedChange `json:"changes"`
}

// updateStatusRequest defines the structure for updating a quote's status.
type updateStatusRequest struct {
	Status string `json:"status"`
}

func (h *LambdaHandler) handlePatchQuoteRequest(request events.APIGatewayProxyRequest, accountID, orgID string, role string, approval resolvedApprovalPolicy, quoteIdStr string) (events.APIGatewayProxyResponse, error) {
	quoteID, err := primitive.ObjectIDFromHex(quoteIdStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid quote ID"), nil
	}

	var patch PatchRequest
	if err := json.Unmarshal([]byte(request.Body), &patch); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body\n"+err.Error()), nil
	}

	// Load once, and authorise against the actual document. Every operation below
	// used to check only the CALLER'S ROLE, never whether the quote belonged to
	// them — so any company token could mutate any other company's quotes, and a
	// customer could act on a stranger's. Reading the quote up front also gives
	// the approval transitions the prior status they need.
	existing, err := h.quoteService.GetQuote(quoteID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "Quote not found"), nil
	}
	switch role {
	case "company":
		// Compared against the organisation, not the individual account, so every
		// account in the selling organisation reaches its own company's quotes.
		if existing.SellerID != orgID {
			return h.errorResponse(http.StatusForbidden, "Forbidden: this quote belongs to another seller"), nil
		}
	case "customer", "b2c":
		if existing.AccountID != accountID && !existing.CanBeReadByApprover(accountID) {
			return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
		}
	case "admin":
		// Admin may act on any quote.
	default:
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}

	var updatedQuote *quote.Quote

	switch patch.Operation {
	case "addComment":
		var commentData struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(patch.Value, &commentData); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid comment data"), nil
		}
		updatedQuote, err = h.quoteService.AddComment(quoteID, accountID, commentData.Text)
	case "applyDiscount":
		if role != "company" && role != "admin" {
			return h.errorResponse(http.StatusForbidden, "Forbidden: Only company or admin can apply discounts"), nil
		}
		if msg := approvalLocksMoney(existing); msg != "" {
			return h.errorResponse(http.StatusConflict, msg), nil
		}
		var discountData applyDiscountRequest
		if err := json.Unmarshal(patch.Value, &discountData); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid discount data"), nil
		}
		updatedQuote, err = h.quoteService.ApplyQuoteDiscount(quoteID, discountData.DiscountPercentage, accountID)
	case "sellerUpdate":
		if role != "company" && role != "admin" {
			return h.errorResponse(http.StatusForbidden, "Forbidden: Only company or admin can update quote as seller"), nil
		}
		if msg := approvalLocksMoney(existing); msg != "" {
			return h.errorResponse(http.StatusConflict, msg), nil
		}
		var sellerUpdateData sellerUpdateRequest
		if err := json.Unmarshal(patch.Value, &sellerUpdateData); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid seller update data"), nil
		}
		updatedQuote, err = h.quoteService.UpdateQuoteBySeller(quoteID, quote.SellerUpdate{
			Items:           sellerUpdateData.Items,
			NewShippingCost: sellerUpdateData.NewShippingCost,
			Notes:           sellerUpdateData.Notes,
		}, accountID)
	case "customerPropose":
		if role != "customer" && role != "b2c" && role != "admin" {
			return h.errorResponse(http.StatusForbidden, "Forbidden: Only customer or admin can propose changes"), nil
		}
		// Ownership, not just readability. The shared authorisation above admits
		// approvers so they can read and decide, but proposing prices is the
		// BUYER's action — without this an approver could rewrite the figures on
		// a colleague's order while it sat waiting for their own sign-off.
		if role != "admin" && existing.AccountID != accountID {
			return h.errorResponse(http.StatusForbidden, "Forbidden: only the buyer who owns this quote can propose changes"), nil
		}
		// Proposing prices is part of quote NEGOTIATION. The portal only ever
		// offers it on a negotiable quote in draft/open/proposed, and the backend
		// must say the same: on a standard quote it is meaningless, and on a held
		// one it moved the quote out of pending_approval with the chain left
		// intact, so the seller's next approve took the ungated path and the order
		// was paid with a level still recorded as pending.
		if existing.QuoteType != "negotiable" {
			return h.errorResponse(http.StatusBadRequest,
				"Prices can only be proposed on a negotiable quote."), nil
		}
		if !existing.OpenToBuyerChanges() {
			return h.errorResponse(http.StatusConflict,
				"This quote is not open for changes. Ask the seller to reopen it."), nil
		}
		var customerProposeData customerProposeRequest
		if err := json.Unmarshal(patch.Value, &customerProposeData); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid customer propose data"), nil
		}
		updatedQuote, err = h.quoteService.CustomerPropose(quoteID, customerProposeData.Changes)
	case "updateStatus":
		if role != "company" && role != "admin" {
			return h.errorResponse(http.StatusForbidden, "Forbidden: Only company or admin can update quote status"), nil
		}
		var statusData updateStatusRequest
		if err := json.Unmarshal(patch.Value, &statusData); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid status data"), nil
		}

		// A buyer's approver said no. That decision is theirs, and the seller must
		// not be able to launder it into an approval through the generic status
		// path — which would leave a payable order carrying a "rejected" step, and
		// on the negotiable side would rebuild the chain as all-pending and erase
		// the refusal outright. Force-release deliberately does NOT cover this: it
		// exists for an approver who never responded, not one who declined.
		if statusData.Status == "approved" && existing.ApprovalRejected() {
			return h.errorResponse(http.StatusConflict,
				"This order was rejected by an approver and cannot be approved here. It must be resubmitted."), nil
		}

		// Seller approval of a negotiated quote that either organisation's policy
		// still gates: settle the prices and hand it to the chain in ONE write, so
		// the quote is never briefly committed as approved-and-payable.
		//
		// Judge both gates on the SETTLED money — what the buyer would actually owe
		// once the negotiated prices are applied. Testing the stored total let a
		// quote negotiated upward past its threshold approve itself. Standard
		// quotes are gated at creation, so only negotiable ones are gated here.
		// CanEnterApproval confines this to states where "the seller approves" is
		// meaningful. Without it the transition also fired from `ordered` (re-running
		// a chain on an order already paid for) and from `rejected`.
		//
		// The two chains are concatenated, seller first, into the single ordered
		// chain the state machine already walks. Seller-side sign-off is a gate on
		// what LEAVES the seller, so it has to clear before the offer is put to the
		// buyer at all; running it second would ask the buyer to approve a price
		// their supplier had not yet committed to.
		var combined []quote.ApprovalStep
		var buyerGated bool
		var validityHours float64
		eligible := statusData.Status == "approved" &&
			existing.QuoteType == "negotiable" &&
			existing.CanEnterApproval()
		if eligible {
			settled := existing.SettledCopy()

			// The SELLING organisation's own policy (Roadmap #21d), read live from
			// the approving account's token. Unlike the buyer's it is never
			// denormalised onto the quote: the seller is present at exactly the
			// moment it is needed, so copying it at create time would only add a
			// stale second copy. Admins carry no policy, so they are unaffected.
			if len(approval.chain) > 0 && quote.PolicyGates(approval.scope, approval.threshold,
				approval.qtyThreshold, existing.QuoteType, settled.GrandTotal, settled.TotalQuantity()) {
				sellerSteps := buildApprovalChain(approval.chain, quote.ApprovalSideSeller, accountID)
				if len(sellerSteps) == 0 {
					// Every configured approver was the person approving. Proceeding
					// without the seller's gate is the only functional option — nobody
					// is left who could clear it — but say so, or a company sees a
					// policy it believes is armed and no gate ever fires. Mirrors the
					// same warning on the buyer's side at quote creation.
					log.Printf("WARN: seller %s has an approval policy whose only approver is %s, who is approving; quote %s proceeds without the seller's gate",
						existing.SellerID, accountID, quoteID.Hex())
				}
				combined = append(combined, sellerSteps...)
				validityHours = approval.validityHours
			}

			// Whether the BUYER's levels will actually run, not merely whether their
			// policy would gate. ShouldGate needs a non-empty chain, and after a
			// withdraw-and-reinstate the stored chain can hold the SELLER's levels —
			// so asking it alone reported "buyer gated" on a quote where no buyer
			// level exists, and then demanded a buyer email to notify about a
			// decision nobody would ever make.
			// StepsForSide, not the whole chain. The stored chain may already hold
			// the seller's own levels from an earlier approval, and feeding the
			// whole thing back through re-tagged those as buyer-side: their
			// company-role approvers could then never clear them (a buyer level
			// demands a customer), stranding the quote in pending_approval with only
			// force-release as a way out, and the seller's levels were appended a
			// second time on top.
			buyerSteps := buildApprovalChain(
				existing.StepsForSide(quote.ApprovalSideBuyer), quote.ApprovalSideBuyer, existing.AccountID)
			buyerGated = len(buyerSteps) > 0 && settled.ShouldGate(existing.QuoteType)
			if buyerGated {
				combined = append(combined, buyerSteps...)
				// The buyer's window wins when both sides set one: it is the buyer's
				// price snapshot going stale that the window exists to bound.
				if existing.ApprovalValidityHours > 0 {
					validityHours = existing.ApprovalValidityHours
				}
			}
		}
		gated := len(combined) > 0

		// An approval must NEVER leave an undecided level behind. Overriding one is
		// a real need, but it has to be asked for explicitly through
		// forceReleaseApproval, which is logged and marks the levels released.
		//
		// Asked AFTER `gated` because the question is about the outcome, not the
		// starting point. Keyed on the prior status instead, this only refused the
		// direct pending_approval -> approved hop, and a seller could launder a
		// held STANDARD order past its chain in two calls: set it to "open" (the
		// guard did not fire, and standard quotes are never re-gated here since
		// they gate at creation), then to "approved". The order became payable with
		// every level still reading "pending" and nothing recorded anywhere.
		//
		// Withdrawing or rejecting a held order stays allowed: stock runs out and
		// prices turn out wrong, and blocking every transition left a seller with
		// no way to cancel at all, since force-release only ever approves.
		//
		// The step must still be PENDING. On a rejection NextApprovalState leaves
		// approvalStage where it is, so CurrentStep keeps returning the step that
		// was just rejected: testing only for non-nil treated a decided step as an
		// undecided one and refused forever. A seller who rejected their own
		// internal sign-off, then re-priced the quote below the threshold so it no
		// longer gates, could never approve it again, and force-release could not
		// rescue it either since that path requires status pending_approval. A
		// rejected step is a DECISION, and re-approving after one is a fresh call
		// that either re-gates on the new price or does not need a chain at all.
		if step := existing.CurrentStep(); statusData.Status == "approved" && !gated &&
			existing.ApprovalRequired && step != nil && step.Status == quote.ApprovalStepPending {
			return h.errorResponse(http.StatusConflict,
				"This order still has an approval level awaiting a decision. Use the release action to override it deliberately."), nil
		}

		// Same rule as create time: a gated order whose buyer cannot be told the
		// outcome is not workable. Checked here too because a quote can be
		// negotiated up past its threshold after being created below it. Applied
		// only when the BUYER's chain is involved — a purely internal seller
		// sign-off is the seller's own business and must not be blocked by a gap in
		// the buyer record.
		if buyerGated && existing.CustomerEmail == "" {
			return h.errorResponse(http.StatusBadRequest,
				"This order now requires buyer approval, but the quote carries no buyer email to notify them of the outcome."), nil
		}

		if gated {
			updatedQuote, err = h.quoteService.ApproveIntoApproval(quoteID, existing.Status, combined, validityHours)
			if err != nil {
				if errors.Is(err, quote.ErrApprovalConflict) {
					return h.errorResponse(http.StatusConflict,
						"This quote changed while you were approving it. Please refresh and try again."), nil
				}
				return h.errorResponse(http.StatusInternalServerError, "Failed to start the approval workflow: "+err.Error()), nil
			}
			h.notifyCurrentApprovers(updatedQuote)
		} else {
			updatedQuote, err = h.quoteService.UpdateQuoteStatus(quoteID, statusData.Status)
		}

	case "forceReleaseApproval":
		// The explicit override, replacing the inferred one. Deliberate, logged,
		// and conditional on the quote genuinely awaiting approval, so a repeated
		// request cannot release something that was never gated.
		if role != "company" && role != "admin" {
			return h.errorResponse(http.StatusForbidden, "Forbidden: Only company or admin can release an approval"), nil
		}
		// Named, because an override is the entry in the log that most needs an
		// owner. The email comes off the token; there is no chain entry to read a
		// display name from, since the releaser is by definition not an approver.
		updatedQuote, err = h.quoteService.ForceRelease(quoteID,
			&quote.Approver{AccountID: accountID, Email: h.requestUserEmail})
		if err != nil {
			return h.errorResponse(http.StatusConflict, err.Error()), nil
		}
		log.Printf("INFO: quote %s force-released by %s, overriding a pending buyer approval", quoteID.Hex(), accountID)
		// The buyer's checkout stopped at "we have notified your approver", so
		// without this they have no way of learning the order became payable
		// except by revisiting the quote.
		h.notifyApprovalOutcome(updatedQuote)

	case "approvalDecision":
		// Sign-off. Authorisation is by membership of the step that is currently
		// awaiting a decision, not by role alone: an approver is an ordinary
		// account inside the organisation that owns the step.
		//
		// The step's own tag decides which role may act. Checking the role alone
		// would let a colleague at the seller clear the buyer's level and vice
		// versa — each side's control would be enforceable by the other, which is
		// precisely what it exists to prevent. Admin is on neither side and is
		// excluded from both; an admin who must unblock a quote uses
		// forceReleaseApproval, which is logged as the override it is.
		currentStep := existing.CurrentStep()
		if currentStep == nil {
			return h.errorResponse(http.StatusConflict, "This quote is not awaiting an approval decision"), nil
		}
		if currentStep.SideOf() == quote.ApprovalSideSeller {
			if role != "company" {
				return h.errorResponse(http.StatusForbidden,
					"Forbidden: this level is approved inside the selling organisation"), nil
			}
		} else if role != "customer" {
			return h.errorResponse(http.StatusForbidden,
				"Forbidden: this level is approved inside the buying organisation"), nil
		}
		var decisionData struct {
			Decision string `json:"decision"`
			Note     string `json:"note,omitempty"`
		}
		if err := json.Unmarshal(patch.Value, &decisionData); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid approval decision data"), nil
		}
		if decisionData.Decision != "approve" && decisionData.Decision != "reject" {
			return h.errorResponse(http.StatusBadRequest, "decision must be \"approve\" or \"reject\""), nil
		}
		if !existing.IsApprover(accountID) {
			return h.errorResponse(http.StatusForbidden, "Forbidden: You are not an approver for this step"), nil
		}
		approver := quote.Approver{AccountID: accountID, Email: h.requestUserEmail}
		// Prefer the configured display name so the audit trail reads well.
		for _, a := range currentStep.Approvers {
			if a.AccountID == accountID {
				if a.Name != "" {
					approver.Name = a.Name
				}
				if a.Email != "" {
					approver.Email = a.Email
				}
				break
			}
		}
		updatedQuote, err = h.quoteService.RecordApprovalDecision(quoteID, approver, decisionData.Decision == "approve", decisionData.Note)
		if err != nil {
			if errors.Is(err, quote.ErrApprovalConflict) {
				return h.errorResponse(http.StatusConflict, err.Error()), nil
			}
			return h.errorResponse(http.StatusBadRequest, err.Error()), nil
		}
		h.notifyApprovalOutcome(updatedQuote)
	default:
		return h.errorResponse(http.StatusBadRequest, "Invalid patch operation"), nil
	}

	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to perform patch operation: "+err.Error()), nil
	}

	return h.successResponse(redactQuoteFor(updatedQuote, role)), nil
}

func (h *LambdaHandler) handleGetMyQuotesRequest(request events.APIGatewayProxyRequest, accountID, orgID string, role string) (events.APIGatewayProxyResponse, error) {
	log.Printf("handleGetMyQuotesRequest: accountID=%s, role=%s", accountID, role)
	var quotes []quote.Quote
	var err error

	sellerID := request.QueryStringParameters["sellerId"]

	if role == "customer" || role == "b2c" {
		quotes, err = h.quoteService.GetQuotesByAccountID(context.Background(), accountID, sellerID)
	} else if role == "company" {
		quotes, err = h.quoteService.GetQuotesBySellerID(context.Background(), orgID)
	} else if role == "admin" {
		quotes, err = h.quoteService.GetQuotesBySellerID(context.Background(), sellerID)
	} else {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}

	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to retrieve quotes"), nil
	}

	if role != "admin" {
		side := approvalSideForRole(role)
		for i := range quotes {
			quotes[i] = *quotes[i].RedactedFor(side)
		}
	}
	respBody, _ := json.Marshal(quotes)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}, nil
}

func (h *LambdaHandler) handleGetQuoteRequest(request events.APIGatewayProxyRequest, accountID, orgID string, role string, quoteIdStr string) (events.APIGatewayProxyResponse, error) {
	quoteID, err := primitive.ObjectIDFromHex(quoteIdStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid quote ID"), nil
	}

	quote, err := h.quoteService.GetQuote(quoteID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "Quote not found"), nil
	}

	// Authorization logic
	isOwner := quote.AccountID == accountID
	isSeller := quote.SellerID == orgID

	switch role {
	case "customer", "b2c":
		// Owner, or someone named anywhere in the approval chain. Strictly more
		// permissive than before, so every existing caller (including every b2c
		// storefront shopper, who owns their quote) still passes.
		if !isOwner && !quote.CanBeReadByApprover(accountID) {
			return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
		}
	case "company":
		if !isSeller {
			return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
		}
	case "admin":
		// Admin can access any quote
	default:
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}

	respBody, _ := json.Marshal(redactQuoteFor(quote, role))
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}, nil
}

// checkoutLineLabel renders the cart as the single line item the shopper sees on
// a hosted checkout page. It is a label only: the charged amount stays the
// quote's grand total, because that total also carries shipping, tax and
// discounts that no per-product breakdown would reconstruct.
//
// Returns "" when there is nothing usable to show, which leaves the gateway on
// its own reference-based fallback.
func checkoutLineLabel(items []cart.CartItem) string {
	named := make([]cart.CartItem, 0, len(items))
	for _, it := range items {
		if strings.TrimSpace(it.Name) != "" {
			named = append(named, it)
		}
	}
	if len(named) == 0 {
		return ""
	}
	label := strings.TrimSpace(named[0].Name)
	if named[0].Quantity > 1 {
		label = fmt.Sprintf("%s (x%d)", label, named[0].Quantity)
	}
	if extra := len(named) - 1; extra > 0 {
		label = fmt.Sprintf("%s + %d more", label, extra)
	}
	return label
}

// checkoutLineImage picks the thumbnail to sit beside that label: the first item
// that actually has one, which need not be the first item in the cart.
func checkoutLineImage(items []cart.CartItem) string {
	for _, it := range items {
		if img := strings.TrimSpace(it.Image); img != "" {
			return img
		}
	}
	return ""
}

func (h *LambdaHandler) handlePlaceOrderRequest(request events.APIGatewayProxyRequest, accountID string, role string, configurations []CustomerConfiguration, approval resolvedApprovalPolicy) (events.APIGatewayProxyResponse, error) {
	var req struct {
		QuoteID           string            `json:"quoteId"`
		PaymentMethod     string            `json:"paymentMethod"`
		PickupLocationID  string            `json:"pickupLocationId,omitempty"`
		DeliveryAddressID string            `json:"deliveryAddressId,omitempty"`
		DeliveryMethod    string            `json:"deliveryMethod"`
		ReturnURL         string            `json:"returnUrl,omitempty"`
		VisitorID         string            `json:"visitorId,omitempty"`
		ClickIDs          map[string]string `json:"clickIds,omitempty"`
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}

	quoteID, err := primitive.ObjectIDFromHex(req.QuoteID)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid quote ID"), nil
	}

	q, err := h.quoteService.GetQuote(quoteID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "Quote not found"), nil
	}

	if q.AccountID != accountID {
		return h.errorResponse(http.StatusForbidden, "You do not own this quote"), nil
	}

	if q.Status != "approved" {
		return h.errorResponse(http.StatusForbidden, "Quote is not approved for order placement"), nil
	}

	// No approval-window check here by design. The window bounds how long an
	// approval REQUEST may sit unanswered — RecordApprovalDecision refuses an
	// expired one, and the window is cleared the moment the chain clears. An
	// order that carries a completed approval is payable like any other; blocking
	// it here instead made settled negotiable quotes permanently unpayable, since
	// those cannot be re-submitted from the cart.

	// Approval backstop, before any gateway call so no money can move.
	//
	// A quote drafted by a sales rep carries no buyer policy: the seller's token
	// has no configurations claim, and accepting a policy from the request body
	// would let a seller name any account as approver. The buyer's own signed
	// claim IS here, so this is where their policy finally applies. Without it a
	// buyer could ask their rep to draft the order and skip their own chain.
	//
	// Only quotes the BUYER's chain has not already decided reach this. A
	// buyer-created quote had that decision made at creation and its money has not
	// changed since, so this cannot double-gate one.
	//
	// Keyed on a buyer-side step rather than on approvalRequired alone: a
	// rep-drafted quote that cleared the SELLER's own levels (#21d) is also marked
	// required, and treating that as "already approved" let the buyer's policy be
	// skipped entirely by asking a rep to draft the order — the exact bypass this
	// backstop exists to close.
	buyerAlreadyDecided := q.ApprovalRequired && q.HasApprovalSide(quote.ApprovalSideBuyer)
	if role == "customer" && !buyerAlreadyDecided {
		policy := approval
		candidate := *q
		candidate.ApprovalScope = policy.scope
		candidate.ApprovalThreshold = policy.threshold
		candidate.ApprovalQuantityThreshold = policy.qtyThreshold
		candidate.ApprovalChain = buildApprovalChain(policy.chain, quote.ApprovalSideBuyer, q.AccountID)
		if candidate.ShouldGate(q.QuoteType) {
			// Levels already signed off at the seller stay on the chain ahead of
			// the buyer's, so the record of who authorised what survives the
			// rebuild, and the stage starts after them.
			settled := q.ResolvedSteps()
			full := append(settled, candidate.ApprovalChain...)
			held, hErr := h.quoteService.HoldForApproval(q.ID, full, len(settled), policy.validityHours, q.Status, h.requestUserEmail)
			if hErr != nil {
				if errors.Is(hErr, quote.ErrApprovalConflict) {
					return h.errorResponse(http.StatusConflict,
						"This order changed while it was being submitted. Please refresh and try again."), nil
				}
				return h.errorResponse(http.StatusInternalServerError, "Could not route this order for approval: "+hErr.Error()), nil
			}
			h.notifyCurrentApprovers(held)
			respBody, _ := json.Marshal(map[string]interface{}{
				"pendingApproval": true,
				"quoteId":         q.ID.Hex(),
				"message":         "This order needs approval from your organisation. We have notified your approver.",
			})
			return events.APIGatewayProxyResponse{
				StatusCode: http.StatusAccepted,
				Headers:    corsHeaders(h.requestOrigin),
				Body:       string(respBody),
			}, nil
		}
	}

	if h.gatewayStore == nil {
		return h.errorResponse(http.StatusServiceUnavailable, "Payment gateway service not configured"), nil
	}

	ctx := context.Background()

	// Look up gateway — first check seller-specific config, then fall back to registry (offline methods)
	gatewayConfig, gwErr := h.gatewayStore.GetConfig(ctx, q.SellerID, req.PaymentMethod)

	gw, gwRegistered := h.gatewayRegistry.Get(req.PaymentMethod)
	if !gwRegistered {
		return h.errorResponse(http.StatusBadRequest, "Unsupported payment method: "+req.PaymentMethod), nil
	}

	// Determine which credentials to use (sandbox vs production)
	var credentials map[string]string
	var sandbox bool
	if gwErr == nil && gatewayConfig != nil {
		sandbox = gatewayConfig.Sandbox
		if sandbox {
			credentials = gatewayConfig.SandboxCredentials
			if len(credentials) == 0 {
				return h.errorResponse(http.StatusBadRequest, "Sandbox credentials not configured for "+req.PaymentMethod), nil
			}
		} else {
			credentials = gatewayConfig.Credentials
			if len(credentials) == 0 {
				return h.errorResponse(http.StatusBadRequest, "Production credentials not configured for "+req.PaymentMethod), nil
			}
		}
	}

	callbackURL := h.apiBaseURL + "/checkout/payment-return"
	sessionReq := gateway.SessionRequest{
		Amount:        q.GrandTotal,
		Currency:      "USD",
		CallbackURL:   callbackURL,
		Credentials:   credentials,
		MerchantRef:   q.ID.Hex(),
		Sandbox:       sandbox,
		CustomerEmail: h.requestUserEmail,
		Description:   checkoutLineLabel(q.Items),
		ImageURL:      checkoutLineImage(q.Items),
	}

	sessionResp, err := gw.CreateSession(ctx, sessionReq)
	if err != nil {
		log.Printf("Gateway CreateSession failed for %s: %v", req.PaymentMethod, err)
		return h.errorResponse(http.StatusInternalServerError, "Payment processing failed. Please try again."), nil
	}

	if sessionResp.RedirectURL != "" || sessionResp.ButtonConfig != nil {
		// Redirect-based or button-based payment
		returnURL := req.ReturnURL
		if returnURL == "" {
			returnURL = h.requestOrigin
		}
		if !isAllowedReturnURL(returnURL) {
			returnURL = h.requestOrigin
		}

		paymentSession := &gateway.PaymentSession{
			QuoteID:           req.QuoteID,
			AccountID:         accountID,
			CustomerEmail:     h.requestUserEmail,
			SellerID:          q.SellerID,
			PaymentMethod:     req.PaymentMethod,
			DeliveryMethod:    req.DeliveryMethod,
			PickupLocationID:  req.PickupLocationID,
			DeliveryAddressID: req.DeliveryAddressID,
			Amount:            q.GrandTotal,
			Currency:          "USD",
			ProviderSessionID: sessionResp.ProviderSessionID,
			InvoiceRef:        sessionResp.InvoiceRef,
			RedirectURL:       sessionResp.RedirectURL,
			ReturnURL:         returnURL,
			VisitorID:         req.VisitorID,
			ClickIDs:          req.ClickIDs,
		}
		if err := h.gatewayStore.CreateSession(ctx, paymentSession); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to create payment session"), nil
		}

		response := map[string]interface{}{
			"paymentSessionId": paymentSession.ID.Hex(),
		}
		if sessionResp.RedirectURL != "" {
			response["redirectUrl"] = sessionResp.RedirectURL
		}
		if sessionResp.ButtonConfig != nil {
			response["buttonConfig"] = sessionResp.ButtonConfig
		}

		respBody, _ := json.Marshal(response)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusAccepted,
			Headers:    corsHeaders(h.requestOrigin),
			Body:       string(respBody),
		}, nil
	}

	// Direct payment (offline: pickup_&_pay, deliver_pay, purchase_order)
	completion, err := gw.CompleteSession(ctx, sessionResp.ProviderSessionID, sessionResp.InvoiceRef, q.GrandTotal, "USD", credentials, sandbox)
	if err != nil {
		return h.errorResponse(http.StatusPaymentRequired, "Payment processing failed"), nil
	}

	return h.createOrderFromQuote(q, accountID, h.requestUserEmail, req.PaymentMethod, req.DeliveryMethod, completion.TransactionID, req.PickupLocationID, req.DeliveryAddressID, req.VisitorID, req.ClickIDs)
}

func (h *LambdaHandler) createOrderFromQuote(q *quote.Quote, accountID, customerEmail, paymentMethod, deliveryMethod, transactionID, pickupLocationID, deliveryAddressID, visitorID string, clickIDs map[string]string) (events.APIGatewayProxyResponse, error) {
	newOrder := &order.Order{
		ID:                primitive.NewObjectID(),
		QuoteID:           q.ID,
		AccountID:         accountID,
		SellerID:          q.SellerID,
		Items:             q.Items,
		Subtotal:          q.Subtotal,
		ShippingCost:      q.ShippingCost,
		TaxAmount:         q.TaxAmount,
		GrandTotal:        q.GrandTotal,
		PaymentMethod:     paymentMethod,
		DeliveryMethod:    deliveryMethod,
		TransactionID:     transactionID,
		PickupLocationID:  pickupLocationID,
		DeliveryAddressID: deliveryAddressID,
		CustomerEmail:     customerEmail,
		VisitorID:         visitorID,
		ClickIDs:          clickIDs,
		// Denormalize coupon from quote so admin order detail, CSV export,
		// and confirmation email can render the breakdown without re-fetching
		// the quote (which may be deleted later).
		PromoCode:     q.PromoCode,
		PromoDiscount: q.PromoDiscount,
	}

	// Snapshot the chosen delivery address from quote.customerAddresses so the
	// order detail view can render the full address after the quote is deleted.
	// Quote is source of truth: customerAddresses was denormalized at quote-create
	// time. If deliveryAddressID does not match (legacy carts, edge cases), the
	// snapshot is left nil — order create flow continues unchanged.
	if deliveryAddressID != "" {
		for i := range q.CustomerAddresses {
			if q.CustomerAddresses[i].ID.Hex() == deliveryAddressID {
				addr := &q.CustomerAddresses[i]
				phone := ""
				if addr.PhoneNumber != nil {
					phone = *addr.PhoneNumber
				}
				newOrder.DeliveryAddress = &order.DeliveryAddress{
					RecipientName: addr.RecipientName,
					Street:        addr.Address.Street,
					City:          addr.Address.City,
					State:         addr.Address.State,
					Zip:           addr.Address.Zip,
					PhoneNumber:   phone,
				}
				break
			}
		}
	}

	createdOrder, err := h.orderService.CreateOrder(newOrder)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to create order"), nil
	}

	_ = h.cartService.ClearCart(accountID, q.SellerID)
	if q.QuoteType == "negotiable" {
		_, err = h.quoteService.UpdateQuoteStatus(q.ID, "ordered")
		if err != nil {
			log.Printf("Failed to update quote status to ordered: %v", err)
		}
	} else {
		_ = h.quoteService.DeleteQuote(q.ID.Hex())
	}

	// Order confirmation email — SYNCHRONOUS so it actually delivers.
	// Lambda freezes its execution environment as soon as the handler returns;
	// fire-and-forget goroutines race the freeze and get cut mid-SMTP-handshake
	// (observed: "WARN: order confirmation email failed: EOF" in CloudWatch).
	// We accept ~300ms added to the checkout response to guarantee delivery.
	// Customer-facing send routes through the company's own SMTP for branding.
	if h.emailSender != nil && customerEmail != "" {
		items := make([]mailer.OrderItemView, 0, len(createdOrder.Items))
		for _, it := range createdOrder.Items {
			items = append(items, mailer.OrderItemView{
				Name:     it.Name,
				Quantity: it.Quantity,
				Price:    effectiveLineSubtotal(it),
				Image:    it.Image,
			})
		}
		brandName, brandEmail := mailer.CompanyBrand(createdOrder.SellerID)
		var addrView *mailer.DeliveryAddressView
		if createdOrder.DeliveryAddress != nil {
			addrView = &mailer.DeliveryAddressView{
				RecipientName: createdOrder.DeliveryAddress.RecipientName,
				Street:        createdOrder.DeliveryAddress.Street,
				City:          createdOrder.DeliveryAddress.City,
				State:         createdOrder.DeliveryAddress.State,
				Zip:           createdOrder.DeliveryAddress.Zip,
				PhoneNumber:   createdOrder.DeliveryAddress.PhoneNumber,
			}
		}
		msg := mailer.OrderConfirmationMessage(customerEmail, mailer.OrderConfirmationData{
			OrderID:         createdOrder.ID.Hex(),
			Subtotal:        createdOrder.Subtotal,
			ShippingCost:    createdOrder.ShippingCost,
			TaxAmount:       createdOrder.TaxAmount,
			PromoCode:       createdOrder.PromoCode,
			PromoDiscount:   createdOrder.PromoDiscount,
			GrandTotal:      createdOrder.GrandTotal,
			Items:           items,
			BrandName:       brandName,
			BrandEmail:      brandEmail,
			DeliveryAddress: addrView,
		})
		sender, _ := mailer.SenderForCompany(context.Background(), createdOrder.SellerID, h.emailSender)
		if err := sender.Send(context.Background(), msg); err != nil {
			log.Printf("WARN: order confirmation email failed for %s: %v", customerEmail, err)
		}

		// Notify the company owner about the new order — platform sender (BC SES).
		if ownerEmail := mailer.CompanyOwnerEmail(createdOrder.SellerID); ownerEmail != "" {
			ownerMsg := mailer.NewOrderToCompanyMessage(ownerEmail, mailer.NewOrderToCompanyData{
				OrderID:         createdOrder.ID.Hex(),
				CustomerEmail:   customerEmail,
				Subtotal:        createdOrder.Subtotal,
				ShippingCost:    createdOrder.ShippingCost,
				TaxAmount:       createdOrder.TaxAmount,
				PromoCode:       createdOrder.PromoCode,
				PromoDiscount:   createdOrder.PromoDiscount,
				GrandTotal:      createdOrder.GrandTotal,
				Items:           items,
				DeliveryAddress: addrView,
			})
			if err := h.emailSender.Send(context.Background(), ownerMsg); err != nil {
				log.Printf("WARN: new-order notification to owner %s failed: %v", ownerEmail, err)
			}
		}
	}

	return h.successResponse(createdOrder), nil
}

func (h *LambdaHandler) handleGetOrdersRequest(request events.APIGatewayProxyRequest, accountID, orgID string, role string) (events.APIGatewayProxyResponse, error) {
	var sellerID string
	if role == "company" {
		// The seller's own orders: scoped to the ORGANISATION so every account in
		// it sees the same book, not just the one that happens to own the id.
		sellerID = orgID
	}
	orders, err := h.orderService.GetOrders(accountID, role, sellerID)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to get orders"), nil
	}
	// Never serialize a nil slice as JSON `null` — an empty result must be `[]`
	// so the frontend never does `.reduce`/`.map` on null.
	if orders == nil {
		orders = []*order.Order{}
	}

	respBody, _ := json.Marshal(orders)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}, nil
}

// handleOrdersExport returns a CSV of orders for a date range. The format
// query parameter selects the column shape:
//   - generic: full ledger (default), suitable for accounting/reporting.
//   - google:  Google Ads offline click-conversions upload (gclid).
//   - bing:    Microsoft Advertising bulk offline conversions (msclkid).
//
// GET /checkout/orders/export?from=<RFC3339>&to=<RFC3339>&format=generic|google|bing
//
//	[&sellerId=<id>] [&conversionName=<name>]
//
// Auth: admin sees all (or filter via sellerId); company sees only their own.
// Mirrors the customer export pattern at /accounts/export.
func (h *LambdaHandler) handleOrdersExport(request events.APIGatewayProxyRequest, accountID, orgID, role string) (events.APIGatewayProxyResponse, error) {
	if role != "admin" && role != "company" {
		return h.errorResponse(http.StatusForbidden, "Only admin or company can export orders"), nil
	}
	q := request.QueryStringParameters
	format := strings.ToLower(q["format"])
	if format == "" {
		format = "generic"
	}
	if format != "generic" && format != "google" && format != "bing" {
		return h.errorResponse(http.StatusBadRequest, "format must be 'generic', 'google', or 'bing'"), nil
	}
	fromStr, toStr := q["from"], q["to"]
	if fromStr == "" || toStr == "" {
		return h.errorResponse(http.StatusBadRequest, "from and to (RFC3339) required"), nil
	}
	from, err := time.Parse(time.RFC3339, fromStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "from: "+err.Error()), nil
	}
	to, err := time.Parse(time.RFC3339, toStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "to: "+err.Error()), nil
	}

	// Scope (mirrors handleGetStatementRequest): admin can pass any sellerId
	// (or empty for all); company is forced to their own organisation.
	sellerID := q["sellerId"]
	if role == "company" {
		sellerID = orgID
	}

	orders, err := h.orderService.GetOrdersForExport(sellerID, format, from, to)
	if err != nil {
		log.Printf("GetOrdersForExport failed: %v", err)
		return h.errorResponse(http.StatusInternalServerError, "Failed to load orders"), nil
	}

	conversionName := q["conversionName"]
	var body, filename string
	dateRange := from.UTC().Format("2006-01-02") + "-to-" + to.UTC().Format("2006-01-02")
	switch format {
	case "generic":
		body = order.FormatGenericCSV(orders)
		filename = "orders-" + dateRange + ".csv"
	case "google":
		body = order.FormatGoogleCSV(orders, conversionName)
		filename = "orders-google-ads-" + dateRange + ".csv"
	case "bing":
		body = order.FormatBingCSV(orders, conversionName)
		filename = "orders-microsoft-ads-" + dateRange + ".csv"
	}

	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers: map[string]string{
			"Content-Type":                "text/csv",
			"Content-Disposition":         "attachment; filename=" + filename,
			"Access-Control-Allow-Origin": h.requestOrigin,
		},
		Body: body,
	}, nil
}

// handleGetStatementRequest computes a billing statement for a seller and period.
// GET /checkout/orders/statement?sellerId=<id>&from=<RFC3339>&to=<RFC3339>
// Auth: admin can request any sellerId; company can request only their own.
// Pure routing/auth — business logic lives in statement.Compute.
func (h *LambdaHandler) handleGetStatementRequest(request events.APIGatewayProxyRequest, accountID, orgID, role, orgRole string) (events.APIGatewayProxyResponse, error) {
	// A billing statement is what this company owes the platform: its tier,
	// monthly fee, per-order rate and transaction fees. That is the owner's
	// business, not every colleague's.
	if msg := notOrgOwner(role, orgRole, "Billing statements are visible to the account owner."); msg != "" {
		return h.errorResponse(http.StatusForbidden, msg), nil
	}
	sellerID := request.QueryStringParameters["sellerId"]
	if sellerID == "" {
		return h.errorResponse(http.StatusBadRequest, "sellerId required"), nil
	}
	if role != "admin" && !(role == "company" && sellerID == orgID) {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}

	fromStr := request.QueryStringParameters["from"]
	toStr := request.QueryStringParameters["to"]
	if fromStr == "" || toStr == "" {
		return h.errorResponse(http.StatusBadRequest, "from and to required (RFC3339)"), nil
	}
	from, err := time.Parse(time.RFC3339, fromStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid from date"), nil
	}
	to, err := time.Parse(time.RFC3339, toStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid to date"), nil
	}
	if !to.After(from) {
		return h.errorResponse(http.StatusBadRequest, "to must be after from"), nil
	}
	if to.Sub(from) > 366*24*time.Hour {
		return h.errorResponse(http.StatusBadRequest, "period exceeds 1 year"), nil
	}

	orders, err := h.orderService.GetSellerOrdersInPeriod(sellerID, from, to)
	if err != nil {
		log.Printf("ERROR: GetSellerOrdersInPeriod: %v", err)
		return h.errorResponse(http.StatusInternalServerError, "Failed to fetch orders"), nil
	}

	computed := statement.Compute(sellerID, from, to, orders)
	respBody, _ := json.Marshal(computed)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}, nil
}

// handleSendStatementRequest sends (or dry-run-renders) a billing statement
// email to a company. Admin-only. On a real (non-dryRun) send, the computed
// values are snapshotted to the statements collection so historical
// recomputation can never drift from what the company was actually billed.
//
// POST /checkout/orders/statement/send
// Body: { sellerId, from (RFC3339), to (RFC3339), recipientEmail, companyName,
//
//	periodLabel, paymentInstructions, dryRun }
func (h *LambdaHandler) handleSendStatementRequest(request events.APIGatewayProxyRequest, accountID, orgID, role, orgRole string) (events.APIGatewayProxyResponse, error) {
	// A billing statement is what this company owes the platform: its tier,
	// monthly fee, per-order rate and transaction fees. That is the owner's
	// business, not every colleague's.
	if msg := notOrgOwner(role, orgRole, "Billing statements are visible to the account owner."); msg != "" {
		return h.errorResponse(http.StatusForbidden, msg), nil
	}
	if role != "admin" {
		return h.errorResponse(http.StatusForbidden, "Forbidden: admin only"), nil
	}

	var req struct {
		SellerID            string `json:"sellerId"`
		From                string `json:"from"`
		To                  string `json:"to"`
		RecipientEmail      string `json:"recipientEmail"`
		CompanyName         string `json:"companyName"`
		PeriodLabel         string `json:"periodLabel"`
		PaymentInstructions string `json:"paymentInstructions"`
		DryRun              bool   `json:"dryRun"`
		AllowDuplicate      bool   `json:"allowDuplicate"`
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}
	if req.SellerID == "" || req.From == "" || req.To == "" || req.RecipientEmail == "" || req.CompanyName == "" || req.PeriodLabel == "" {
		return h.errorResponse(http.StatusBadRequest, "sellerId, from, to, recipientEmail, companyName, periodLabel are required"), nil
	}
	if _, err := mail.ParseAddress(req.RecipientEmail); err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid recipientEmail"), nil
	}
	if len(req.PaymentInstructions) > 2000 {
		return h.errorResponse(http.StatusBadRequest, "paymentInstructions too long (max 2000 chars)"), nil
	}

	from, err := time.Parse(time.RFC3339, req.From)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid from date"), nil
	}
	to, err := time.Parse(time.RFC3339, req.To)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid to date"), nil
	}
	if !to.After(from) {
		return h.errorResponse(http.StatusBadRequest, "to must be after from"), nil
	}
	if to.Sub(from) > 366*24*time.Hour {
		return h.errorResponse(http.StatusBadRequest, "period exceeds 1 year"), nil
	}

	orders, err := h.orderService.GetSellerOrdersInPeriod(req.SellerID, from, to)
	if err != nil {
		log.Printf("ERROR: GetSellerOrdersInPeriod: %v", err)
		return h.errorResponse(http.StatusInternalServerError, "Failed to fetch orders"), nil
	}

	computed := statement.Compute(req.SellerID, from, to, orders)
	emailData := buildStatementEmailData(computed, req.CompanyName, req.PeriodLabel, req.PaymentInstructions)
	msg := mailer.MonthlyStatementMessage(req.RecipientEmail, emailData)

	if req.DryRun {
		// Return the rendered email body without sending. Admin previews before commit.
		respBody, _ := json.Marshal(map[string]interface{}{
			"dryRun":    true,
			"recipient": req.RecipientEmail,
			"subject":   msg.Subject,
			"htmlBody":  msg.HTMLBody,
			"textBody":  msg.TextBody,
			"statement": computed,
		})
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    corsHeaders(h.requestOrigin),
			Body:       string(respBody),
		}, nil
	}

	// Duplicate guard. Placed AFTER the dry-run return so a preview always
	// renders, and BEFORE the send so a refused duplicate never reaches the
	// customer: Save only runs once the email is away, so a guard any later
	// would leave the company holding a second invoice we have no record of.
	// Billing the same period twice is nearly always a slip; when it is not, the
	// caller says so with allowDuplicate rather than the platform guessing.
	if !req.AllowDuplicate {
		existing, dupErr := h.statementService.FindByPeriod(req.SellerID, from, to)
		if dupErr != nil {
			log.Printf("ERROR: FindByPeriod: %v", dupErr)
			return h.errorResponse(http.StatusInternalServerError, "Failed to check existing statements"), nil
		}
		if existing != nil {
			return h.errorResponse(http.StatusConflict, fmt.Sprintf(
				"A statement for this period was already sent to %s on %s for $%.2f. Retract it first, or confirm to send anyway.",
				existing.RecipientEmail, existing.SentAt.Format("2006-01-02"), existing.TotalDue)), nil
		}
	}

	if h.emailSender == nil {
		return h.errorResponse(http.StatusServiceUnavailable, "Email sender not configured"), nil
	}
	if err := h.emailSender.Send(context.Background(), msg); err != nil {
		log.Printf("ERROR: statement email send failed for seller=%s recipient=%s: %v", req.SellerID, req.RecipientEmail, err)
		// Statements are billing artifacts. A failed send means a tenant did not
		// get billed. Alert so we can re-trigger before month-end accounting.
		mailer.NotifyAdmin(h.emailSender, "statement email send failed",
			fmt.Sprintf("seller=%s recipient=%s err=%v", req.SellerID, req.RecipientEmail, err))
		return h.errorResponse(http.StatusInternalServerError, "Failed to send email"), nil
	}
	log.Printf("INFO: statement email sent to %s for seller=%s period=%s total=$%.2f", req.RecipientEmail, req.SellerID, req.PeriodLabel, computed.TotalDue)

	// Snapshot the sent statement. The send already succeeded, so DB failure
	// here means the customer got a bill we don't have a record of — log loudly
	// but still return success so admin knows the email went out.
	snapshot := &statement.Statement{
		SellerID:            req.SellerID,
		PeriodStart:         from,
		PeriodEnd:           to,
		PeriodLabel:         req.PeriodLabel,
		OrderCount:          computed.OrderCount,
		TotalGrandTotal:     computed.TotalGrandTotal,
		TotalRefunded:       computed.TotalRefunded,
		Tier:                computed.Tier,
		MonthlyFee:          computed.MonthlyFee,
		PerOrderRate:        computed.PerOrderRate,
		PerOrderCap:         computed.PerOrderCap,
		TransactionFees:     computed.TransactionFees,
		TotalDue:            computed.TotalDue,
		RecipientEmail:      req.RecipientEmail,
		CompanyName:         req.CompanyName,
		PaymentInstructions: req.PaymentInstructions,
		SentAt:              time.Now().UTC(),
		SentByAdminID:       accountID,
	}
	saved, saveErr := h.statementService.Save(snapshot)
	if saveErr != nil {
		log.Printf("ERROR: statement snapshot save failed (email already sent) seller=%s: %v", req.SellerID, saveErr)
	}

	respBody, _ := json.Marshal(map[string]interface{}{
		"dryRun":    false,
		"sent":      true,
		"recipient": req.RecipientEmail,
		"statement": computed,
		"snapshot":  saved,
	})
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}, nil
}

// handleStatementsRequest serves persisted statement history (GET) and admin
// retraction (DELETE for a statement sent in error). All other methods rejected.
//
//	GET    /checkout/statements?sellerId=<id>   admin or own-seller
//	PUT    /checkout/statements/{id}            admin only, mark paid / unpaid
//	DELETE /checkout/statements/{id}            admin only
func (h *LambdaHandler) handleStatementsRequest(request events.APIGatewayProxyRequest, accountID, orgID, role, orgRole string) (events.APIGatewayProxyResponse, error) {
	// A billing statement is what this company owes the platform: its tier,
	// monthly fee, per-order rate and transaction fees. That is the owner's
	// business, not every colleague's.
	if msg := notOrgOwner(role, orgRole, "Billing statements are visible to the account owner."); msg != "" {
		return h.errorResponse(http.StatusForbidden, msg), nil
	}
	parts := strings.Split(strings.Trim(request.Path, "/"), "/")
	// parts: ["checkout", "statements"] or ["checkout", "statements", "{id}"]

	if request.HTTPMethod == "GET" && len(parts) == 2 {
		sellerID := request.QueryStringParameters["sellerId"]
		if sellerID == "" {
			return h.errorResponse(http.StatusBadRequest, "sellerId required"), nil
		}
		if role != "admin" && !(role == "company" && sellerID == orgID) {
			return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
		}
		stmts, err := h.statementService.ListBySeller(sellerID, 24)
		if err != nil {
			log.Printf("ERROR: ListBySeller: %v", err)
			return h.errorResponse(http.StatusInternalServerError, "Failed to fetch statements"), nil
		}
		if stmts == nil {
			stmts = []*statement.Statement{}
		}
		respBody, _ := json.Marshal(stmts)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    corsHeaders(h.requestOrigin),
			Body:       string(respBody),
		}, nil
	}

	if request.HTTPMethod == "DELETE" && len(parts) == 3 {
		if role != "admin" {
			return h.errorResponse(http.StatusForbidden, "Forbidden: admin only"), nil
		}
		oid, err := primitive.ObjectIDFromHex(parts[2])
		if err != nil {
			return h.errorResponse(http.StatusBadRequest, "invalid statement id"), nil
		}
		ok, err := h.statementService.Delete(oid)
		if err != nil {
			log.Printf("ERROR: statement Delete: %v", err)
			return h.errorResponse(http.StatusInternalServerError, "Failed to delete"), nil
		}
		if !ok {
			return h.errorResponse(http.StatusNotFound, "Statement not found"), nil
		}
		log.Printf("INFO: admin %s retracted statement %s", accountID, parts[2])
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    corsHeaders(h.requestOrigin),
			Body:       `{"deleted":true}`,
		}, nil
	}

	// Payment settlement. PaidAt and PaymentReference were reserved on the model
	// from the start precisely so this needed no migration; this is the write
	// path they were waiting for. Admin only, like retraction: a company must not
	// be able to declare its own bill settled.
	if request.HTTPMethod == "PUT" && len(parts) == 3 {
		if role != "admin" {
			return h.errorResponse(http.StatusForbidden, "Forbidden: admin only"), nil
		}
		oid, err := primitive.ObjectIDFromHex(parts[2])
		if err != nil {
			return h.errorResponse(http.StatusBadRequest, "invalid statement id"), nil
		}
		var body struct {
			Paid             bool   `json:"paid"`
			PaymentReference string `json:"paymentReference"`
		}
		if err := json.Unmarshal([]byte(request.Body), &body); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
		}
		if len(body.PaymentReference) > 200 {
			return h.errorResponse(http.StatusBadRequest, "paymentReference too long (max 200 chars)"), nil
		}
		updated, err := h.statementService.SetPaid(oid, body.Paid, body.PaymentReference)
		if err != nil {
			log.Printf("ERROR: statement SetPaid: %v", err)
			return h.errorResponse(http.StatusInternalServerError, "Failed to update statement"), nil
		}
		if updated == nil {
			return h.errorResponse(http.StatusNotFound, "Statement not found"), nil
		}
		log.Printf("INFO: admin %s set statement %s paid=%v", accountID, parts[2], body.Paid)
		respBody, _ := json.Marshal(updated)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    corsHeaders(h.requestOrigin),
			Body:       string(respBody),
		}, nil
	}

	return h.errorResponse(http.StatusMethodNotAllowed, "Use GET /checkout/statements, PUT /checkout/statements/{id} or DELETE /checkout/statements/{id}"), nil
}

// buildStatementEmailData adapts the statement.Computed domain object to the
// flat email DTO. Pre-formats the per-order rate string so the email package
// stays decoupled from pricing-tier logic.
func buildStatementEmailData(stmt statement.Computed, companyName, periodLabel, paymentInstructions string) mailer.MonthlyStatementData {
	// Marginal bands mean there is no single rate to quote, so the email states
	// the schedule rather than a number that would misdescribe the bill. The cap
	// is the part sellers actually care about and it now holds in every band.
	rateStr := "6% on orders 1-100, 2% on 101-1,000, 1% beyond. Never more than $5 per order."
	return mailer.MonthlyStatementData{
		CompanyName:         companyName,
		PeriodLabel:         periodLabel,
		Tier:                stmt.Tier,
		OrderCount:          stmt.OrderCount,
		TotalGrandTotal:     stmt.TotalGrandTotal,
		TotalRefunded:       stmt.TotalRefunded,
		MonthlyFee:          stmt.MonthlyFee,
		PerOrderRateStr:     rateStr,
		TransactionFees:     stmt.TransactionFees,
		TotalDue:            stmt.TotalDue,
		PaymentInstructions: paymentInstructions,
	}
}

func (h *LambdaHandler) handleDeleteOrderRequest(orderIDStr string, role string) (events.APIGatewayProxyResponse, error) {
	if role != "admin" {
		return h.errorResponse(http.StatusForbidden, "Forbidden: admin only"), nil
	}
	orderID, err := primitive.ObjectIDFromHex(orderIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid order ID"), nil
	}
	if err := h.orderService.DeleteOrder(orderID); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to delete order"), nil
	}
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusNoContent,
		Headers:    corsHeaders(h.requestOrigin),
	}, nil
}

var validOrderStatuses = map[string]bool{
	"pending": true, "processing": true, "shipped": true,
	"delivered": true, "cancelled": true, "returned": true,
	"refunded": true,
}

var validTrackingCarriers = map[string]bool{
	"ups": true, "fedex": true, "usps": true, "dhl": true, "other": true,
}

func effectiveLineSubtotal(it cart.CartItem) float64 {
	if it.LineItemTotal > 0 {
		return it.LineItemTotal
	}
	unit := it.DiscountedPrice
	if unit == 0 {
		unit = it.Price
	}
	return unit * float64(it.Quantity)
}

// roundCents rounds a monetary amount to whole cents. Percentage-based tax and
// discount math leaves sub-cent fractions (e.g. 12.50 * 8.25% = 1.03125) that
// otherwise flow into the persisted quote/order total.
func roundCents(v float64) float64 {
	return math.Round(v*100) / 100
}

func trackingURLFor(carrier, number string) string {
	if number == "" {
		return ""
	}
	switch carrier {
	case "ups":
		return "https://www.ups.com/track?tracknum=" + number
	case "fedex":
		return "https://www.fedex.com/fedextrack/?tracknumbers=" + number
	case "usps":
		return "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + number
	case "dhl":
		return "https://www.dhl.com/en/express/tracking.html?AWB=" + number
	}
	return ""
}

func (h *LambdaHandler) handleUpdateOrderRequest(orderIDStr string, request events.APIGatewayProxyRequest, accountID, orgID, role string) (events.APIGatewayProxyResponse, error) {
	if role != "admin" && role != "company" {
		return h.errorResponse(http.StatusForbidden, "Forbidden: admin or company only"), nil
	}
	orderID, err := primitive.ObjectIDFromHex(orderIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid order ID"), nil
	}
	var req struct {
		Status          string `json:"status"`
		TrackingNumber  string `json:"trackingNumber"`
		TrackingCarrier string `json:"trackingCarrier"`
		// Refund fields. When refundAmount > 0, a refund record is appended and
		// status auto-transitions to "refunded" if it makes the sum equal GrandTotal.
		// Status cannot be set to "refunded" directly via this endpoint (data
		// integrity: refunded status implies a refund record exists).
		StripeRefundID        string                       `json:"stripeRefundID"`
		RefundAmount          float64                      `json:"refundAmount"`
		RefundReason          string                       `json:"refundReason"`
		RefundItemAdjustments []order.RefundItemAdjustment `json:"refundItemAdjustments"`
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}
	// Reject direct status="refunded" — must come through refund flow.
	if req.Status == "refunded" && req.RefundAmount <= 0 {
		return h.errorResponse(http.StatusBadRequest,
			"Cannot set status to refunded directly. Provide refundAmount + stripeRefundID to record a refund."), nil
	}
	if req.Status != "" && !validOrderStatuses[req.Status] {
		return h.errorResponse(http.StatusBadRequest, "Invalid status"), nil
	}
	if req.TrackingCarrier != "" && !validTrackingCarriers[req.TrackingCarrier] {
		return h.errorResponse(http.StatusBadRequest, "Invalid carrier"), nil
	}
	existing, err := h.orderService.GetByID(orderID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "Order not found"), nil
	}
	if role == "company" && existing.SellerID != orgID {
		return h.errorResponse(http.StatusForbidden, "Forbidden: not your order"), nil
	}

	// Build OrderUpdate. Include refund block only when refundAmount > 0.
	upd := order.OrderUpdate{
		Status:          req.Status,
		TrackingNumber:  req.TrackingNumber,
		TrackingCarrier: req.TrackingCarrier,
		TrackingURL:     trackingURLFor(req.TrackingCarrier, req.TrackingNumber),
	}
	if req.RefundAmount > 0 {
		if req.StripeRefundID == "" {
			return h.errorResponse(http.StatusBadRequest,
				"stripeRefundID is required when refundAmount > 0"), nil
		}
		upd.AddRefund = &order.Refund{
			StripeRefundID:  req.StripeRefundID,
			Amount:          req.RefundAmount,
			Reason:          req.RefundReason,
			ItemAdjustments: req.RefundItemAdjustments,
			RefundedBy:      accountID,
		}
		// Caller's intent: clear any explicit status here — refund flow controls
		// transition to "refunded" automatically when it becomes full.
		upd.Status = ""
	}

	updated, err := h.orderService.UpdateOrder(orderID, upd)
	if err != nil {
		// Refund validation errors (cap exceeded, etc.) surface as 400 not 500.
		if strings.Contains(err.Error(), "refund") || strings.Contains(err.Error(), "stripeRefundID") {
			return h.errorResponse(http.StatusBadRequest, err.Error()), nil
		}
		return h.errorResponse(http.StatusInternalServerError, "Failed to update order"), nil
	}

	// Refund notifications: when a refund was just appended, notify both the
	// customer and the company owner. Synchronous send (same Lambda
	// goroutine-vs-freeze concern as other order emails).
	if req.RefundAmount > 0 && len(updated.Refunds) > len(existing.Refunds) && h.emailSender != nil {
		justAdded := updated.Refunds[len(updated.Refunds)-1]
		refundType := updated.RefundStatus() // "partial" or "full"

		// Build itemized view from the refund's adjustments (look up product
		// names from the order's existing Items so the email shows readable text).
		nameByProduct := map[string]string{}
		for _, it := range updated.Items {
			nameByProduct[it.ProductID] = it.Name
		}
		refundItems := make([]mailer.OrderRefundedItem, 0, len(justAdded.ItemAdjustments))
		for _, adj := range justAdded.ItemAdjustments {
			name := nameByProduct[adj.ProductID]
			if name == "" {
				name = "Item"
			}
			refundItems = append(refundItems, mailer.OrderRefundedItem{
				Name:     name,
				Quantity: adj.Quantity,
				Amount:   adj.LineAmount,
			})
		}

		// Stripe reference: last 8 chars for trust signal without exposing full ID.
		stripeRef := justAdded.StripeRefundID
		if len(stripeRef) > 8 {
			stripeRef = stripeRef[len(stripeRef)-8:]
		}

		brandName, brandEmail := mailer.CompanyBrand(updated.SellerID)
		data := mailer.OrderRefundedData{
			OrderID:         updated.ID.Hex(),
			Type:            refundType,
			RefundAmount:    justAdded.Amount,
			GrandTotal:      updated.GrandTotal,
			NetTotal:        updated.NetTotal(),
			Reason:          justAdded.Reason,
			StripeRefundRef: stripeRef,
			Items:           refundItems,
			BrandName:       brandName,
			BrandEmail:      brandEmail,
		}
		sender, _ := mailer.SenderForCompany(context.Background(), updated.SellerID, h.emailSender)

		// Send to customer (always, if email present).
		if updated.CustomerEmail != "" {
			if err := sender.Send(context.Background(),
				mailer.OrderRefundedMessage(updated.CustomerEmail, data)); err != nil {
				log.Printf("WARN: refund email to customer %s failed: %v", updated.CustomerEmail, err)
			}
		}
		// Send to company owner (if known).
		if ownerEmail := mailer.CompanyOwnerEmail(updated.SellerID); ownerEmail != "" {
			if err := sender.Send(context.Background(),
				mailer.OrderRefundedMessage(ownerEmail, data)); err != nil {
				log.Printf("WARN: refund email to company owner %s failed: %v", ownerEmail, err)
			}
		}
	}

	// Notify customer when order first transitions to "shipped" — synchronous so it
	// actually delivers (same Lambda goroutine-vs-freeze concern as confirmation).
	if req.Status == "shipped" && existing.Status != "shipped" && updated.CustomerEmail != "" && h.emailSender != nil {
		items := make([]mailer.OrderItemView, 0, len(updated.Items))
		for _, it := range updated.Items {
			items = append(items, mailer.OrderItemView{
				Name:     it.Name,
				Quantity: it.Quantity,
				Price:    effectiveLineSubtotal(it),
				Image:    it.Image,
			})
		}
		brandName, brandEmail := mailer.CompanyBrand(updated.SellerID)
		msg := mailer.OrderShippedMessage(updated.CustomerEmail, mailer.OrderShippedData{
			OrderID:         updated.ID.Hex(),
			GrandTotal:      updated.GrandTotal,
			Items:           items,
			TrackingCarrier: updated.TrackingCarrier,
			TrackingNumber:  updated.TrackingNumber,
			TrackingURL:     updated.TrackingURL,
			BrandName:       brandName,
			BrandEmail:      brandEmail,
		})
		sender, _ := mailer.SenderForCompany(context.Background(), updated.SellerID, h.emailSender)
		if err := sender.Send(context.Background(), msg); err != nil {
			log.Printf("WARN: order shipped email failed for %s: %v", updated.CustomerEmail, err)
		}
	}

	// Notify on first transition to "cancelled". Same architecture as the
	// new-order block in placeOrder: customer through the merchant's own sender,
	// owner through the platform sender, failures logged and never blocking.
	if req.Status == "cancelled" && existing.Status != "cancelled" &&
		h.emailSender != nil && updated.CustomerEmail != "" {
		items := make([]mailer.OrderItemView, 0, len(updated.Items))
		for _, it := range updated.Items {
			items = append(items, mailer.OrderItemView{
				Name:     it.Name,
				Quantity: it.Quantity,
				Price:    effectiveLineSubtotal(it),
				Image:    it.Image,
			})
		}
		brandName, brandEmail := mailer.CompanyBrand(updated.SellerID)
		msg := mailer.OrderCancelledMessage(updated.CustomerEmail, mailer.OrderCancelledData{
			OrderID:    updated.ID.Hex(),
			GrandTotal: updated.GrandTotal,
			Items:      items,
			BrandName:  brandName,
			BrandEmail: brandEmail,
		})
		sender, _ := mailer.SenderForCompany(context.Background(), updated.SellerID, h.emailSender)
		if err := sender.Send(context.Background(), msg); err != nil {
			log.Printf("WARN: order cancelled email failed for %s: %v", updated.CustomerEmail, err)
		}

		// Notify the company owner about the cancellation, platform sender (BC SES).
		if ownerEmail := mailer.CompanyOwnerEmail(updated.SellerID); ownerEmail != "" {
			ownerMsg := mailer.OrderCancelledToCompanyMessage(ownerEmail, mailer.OrderCancelledToCompanyData{
				OrderID:       updated.ID.Hex(),
				CustomerEmail: updated.CustomerEmail,
				GrandTotal:    updated.GrandTotal,
				Items:         items,
			})
			if err := h.emailSender.Send(context.Background(), ownerMsg); err != nil {
				log.Printf("WARN: order cancelled notification to owner %s failed: %v", ownerEmail, err)
			}
		}
	}

	return h.successResponse(updated), nil
}

// handleRequestReviewRequest sends a post-purchase review-request email to the
// customer and marks the order with reviewRequestedAt. Admin/company only.
// Customer replies by email; admin manually transcribes the review into the
// product via the catalog admin UI (intentional manual moderation, no spam vector).
func (h *LambdaHandler) handleRequestReviewRequest(orderIDStr, accountID, orgID, role string) (events.APIGatewayProxyResponse, error) {
	if role != "admin" && role != "company" {
		return h.errorResponse(http.StatusForbidden, "Forbidden: admin or company only"), nil
	}
	orderID, err := primitive.ObjectIDFromHex(orderIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid order ID"), nil
	}
	existing, err := h.orderService.GetByID(orderID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "Order not found"), nil
	}
	if role == "company" && existing.SellerID != orgID {
		return h.errorResponse(http.StatusForbidden, "Forbidden: not your order"), nil
	}
	// A review request only makes sense once the customer has the goods, so gate
	// on shipped/delivered. Mirrors the portal button gating; enforced here so the
	// endpoint can't be driven for a pending/cancelled order.
	if existing.Status != "shipped" && existing.Status != "delivered" {
		return h.errorResponse(http.StatusConflict, "Review can only be requested once the order is shipped or delivered"), nil
	}
	if existing.CustomerEmail == "" {
		return h.errorResponse(http.StatusBadRequest, "Order has no customer email"), nil
	}
	if h.emailSender == nil {
		return h.errorResponse(http.StatusServiceUnavailable, "Email sending not configured"), nil
	}

	items := make([]mailer.OrderItemView, 0, len(existing.Items))
	for _, it := range existing.Items {
		items = append(items, mailer.OrderItemView{
			Name:     it.Name,
			Quantity: it.Quantity,
			Price:    effectiveLineSubtotal(it),
			Image:    it.Image,
		})
	}
	brandName, brandEmail := mailer.CompanyBrand(existing.SellerID)
	msg := mailer.ReviewRequestMessage(existing.CustomerEmail, mailer.ReviewRequestData{
		OrderID:    existing.ID.Hex(),
		Items:      items,
		BrandName:  brandName,
		BrandEmail: brandEmail,
	})
	sender, _ := mailer.SenderForCompany(context.Background(), existing.SellerID, h.emailSender)
	if err := sender.Send(context.Background(), msg); err != nil {
		log.Printf("WARN: review-request email failed for %s: %v", existing.CustomerEmail, err)
		return h.errorResponse(http.StatusBadGateway, "Failed to send email"), nil
	}

	updated, err := h.orderService.UpdateOrder(orderID, order.OrderUpdate{SetReviewRequested: true})
	if err != nil {
		// Email already sent; log + return success so UI updates even if mark fails.
		log.Printf("WARN: failed to mark reviewRequestedAt for %s: %v", orderIDStr, err)
		return h.successResponse(existing), nil
	}
	return h.successResponse(updated), nil
}

// sameCurrentApprovers reports whether two quotes are waiting on the same set of
// people. Used so a resubmission whose approvers were reconfigured still sends a
// fresh request even when the money did not move.
func sameCurrentApprovers(a, b *quote.Quote) bool {
	stepA, stepB := a.CurrentStep(), b.CurrentStep()
	if stepA == nil || stepB == nil {
		return stepA == stepB
	}
	if len(stepA.Approvers) != len(stepB.Approvers) {
		return false
	}
	seen := make(map[string]bool, len(stepA.Approvers))
	for _, x := range stepA.Approvers {
		seen[x.AccountID] = true
	}
	for _, y := range stepB.Approvers {
		if !seen[y.AccountID] {
			return false
		}
	}
	return true
}

// notifyCurrentApprovers emails everyone who can clear the step now awaiting a
// decision. Sent synchronously: Lambda freezes the execution environment once the
// handler returns, so a goroutine send is unreliable (same reason the quote and
// order confirmation mails are synchronous).
func (h *LambdaHandler) notifyCurrentApprovers(q *quote.Quote) {
	if h.emailSender == nil || q == nil {
		return
	}
	step := q.CurrentStep()
	if step == nil {
		return
	}
	brandName, brandEmail := mailer.CompanyBrand(q.SellerID)
	sender, _ := mailer.SenderForCompany(context.Background(), q.SellerID, h.emailSender)
	expires := ""
	if q.ApprovalExpiresAt != nil {
		expires = q.ApprovalExpiresAt.Format("2 Jan 2006, 15:04 MST")
	}
	for _, approver := range step.Approvers {
		if approver.Email == "" {
			// Address is denormalised onto the chain precisely so we never have to
			// call account-service to resolve it. A blank one means the config was
			// saved without it; log rather than reach across the service boundary.
			log.Printf("WARN: approver %s on quote %s has no email on the chain, cannot notify", approver.AccountID, q.ID.Hex())
			continue
		}
		msg := mailer.ApprovalRequestMessage(approver.Email, mailer.ApprovalRequestData{
			QuoteID: q.ID.Hex(),
			// A seller's own manager is approving something different: their rep
			// wants to SEND this quote, and the customer has not seen it yet.
			SellerSide: step.SideOf() == quote.ApprovalSideSeller,
			// Who placed the order is the first thing an approver needs, and the
			// template has always had a slot for it. The buyer's name is not
			// available here (the JWT carries no name), so their address is the
			// honest identifier — better than the field going unrendered.
			RequesterName: q.CustomerEmail,
			StepName:      step.Name,
			GrandTotal:    q.GrandTotal,
			ExpiresAt:     expires,
			BrandName:     brandName,
			BrandEmail:    brandEmail,
		})
		if err := sender.Send(context.Background(), msg); err != nil {
			log.Printf("WARN: approval request email failed for %s: %v", approver.Email, err)
		}
	}
}

// notifyApprovalOutcome tells the buyer where their order stands after a
// decision, and pulls in the next tier of approvers when one remains.
func (h *LambdaHandler) notifyApprovalOutcome(q *quote.Quote) {
	if h.emailSender == nil || q == nil {
		return
	}
	if q.Status == quote.StatusPendingApproval {
		h.notifyCurrentApprovers(q)
		return
	}
	// A rejection on the SELLER's own chain is internal and stops here. The quote
	// never reached the buyer, so telling them it was "rejected" announces an offer
	// they were never shown and leaks an internal pricing decision ("margin too
	// thin") to the customer it was about. On a rejection approvalStage is left
	// pointing at the step that was just decided, so CurrentStep identifies whose
	// chain it was. Approvals are unaffected: those advance the quote to the buyer,
	// which is exactly when the buyer should hear about it.
	if q.Status == "rejected" {
		if step := q.CurrentStep(); step != nil && step.SideOf() == quote.ApprovalSideSeller {
			return
		}
	}
	// Goes to the BUYER waiting on the outcome, not h.requestUserEmail — that is
	// the approver who just decided, and mailing them about their own click tells
	// the person actually blocked on this nothing at all.
	if q.CustomerEmail == "" {
		log.Printf("WARN: quote %s has no customerEmail; cannot notify the buyer of approval outcome %q", q.ID.Hex(), q.Status)
		return
	}
	brandName, brandEmail := mailer.CompanyBrand(q.SellerID)
	sender, _ := mailer.SenderForCompany(context.Background(), q.SellerID, h.emailSender)
	msg := mailer.QuoteStatusMessage(q.CustomerEmail, mailer.QuoteStatusData{
		QuoteID:    q.ID.Hex(),
		Status:     q.Status,
		BrandName:  brandName,
		BrandEmail: brandEmail,
	})
	if err := sender.Send(context.Background(), msg); err != nil {
		log.Printf("WARN: approval outcome email failed for %s: %v", q.CustomerEmail, err)
	}
}

// notOrgOwner reports why a caller may not touch something reserved to the
// organisation's owner, or "" when they may.
//
// Used for the two things that are the business's money rather than its trade:
// payment gateway credentials, and the platform billing statements that say what
// this company owes. Day-to-day work (orders, quotes, customers) is deliberately
// not gated here.
//
// An ABSENT org_role is never restricted. It is absent on platform-admin tokens
// and on any token minted before #35g; treating those as junior would lock the
// owner out of their own billing for the life of their session. Every org-capable
// token carries an explicit value.
func notOrgOwner(role, orgRole, what string) string {
	if role == "company" && orgRole != "" && orgRole != "owner" {
		return what
	}
	return ""
}

// approvalSideForRole maps a caller to the side of the trade whose approval
// levels they are entitled to see in full. Admin sees everything: they are the
// platform operator, not a party to the trade.
func approvalSideForRole(role string) string {
	if role == "company" {
		return quote.ApprovalSideSeller
	}
	return quote.ApprovalSideBuyer
}

// redactQuoteFor applies that to a single quote, leaving admin untouched.
func redactQuoteFor(q *quote.Quote, role string) *quote.Quote {
	if role == "admin" {
		return q
	}
	return q.RedactedFor(approvalSideForRole(role))
}

// approvalLocksMoney reports why a quote's money must not be changed right now,
// or "" when it may be.
//
// Once a buyer's approval chain is running, or has run, the figures are what
// somebody signed off on. Re-pricing underneath that produced an order payable at
// a total no approver ever saw, with the earlier decision still recorded against
// it and nobody re-notified.
func approvalLocksMoney(q *quote.Quote) string {
	if q == nil {
		return ""
	}
	if q.Status == quote.StatusPendingApproval {
		who := "the buyer"
		if step := q.CurrentStep(); step != nil && step.SideOf() == quote.ApprovalSideSeller {
			who = "your own organisation"
		}
		return "This order is awaiting approval by " + who + ", so its prices cannot be changed. Release or withdraw it first."
	}
	if q.ApprovalRequired && q.Status == "approved" {
		return "This order has already been through approval, so its prices cannot be changed."
	}
	// A paid order's quote is the record of what was actually bought. The order
	// carries its own snapshot so the charge cannot change retroactively, but
	// re-pricing the quote underneath it destroys the trail showing what the buyer
	// approved and paid.
	if q.Status == "ordered" {
		return "This quote has already been ordered, so its prices cannot be changed."
	}
	return ""
}

// resolvedApprovalPolicy is a buyer's own approval policy for one seller, read
// out of their signed claim.
type resolvedApprovalPolicy struct {
	scope         string
	threshold     float64
	qtyThreshold  float64
	validityHours float64
	chain         []quote.ApprovalStep
}

// approvalPolicyFromClaim reads the organisation's approval policy out of the
// signed token. Returns a zero policy when there is none, which gates nothing.
//
// One decode per request, into one value, whichever side of the trade the caller
// is on: a buying organisation gating its own spending, or a selling organisation
// requiring internal sign-off before a quote goes out.
func approvalPolicyFromClaim(userClaim map[string]interface{}) resolvedApprovalPolicy {
	var p resolvedApprovalPolicy
	raw, ok := userClaim["orgApproval"]
	if !ok || raw == nil {
		return p
	}
	b, mErr := json.Marshal(raw)
	if mErr != nil {
		return p
	}
	var claim struct {
		Scope             string               `json:"scope"`
		Threshold         *float64             `json:"threshold"`
		QuantityThreshold *float64             `json:"quantityThreshold"`
		ValidityHours     *float64             `json:"validityHours"`
		Chain             []quote.ApprovalStep `json:"chain"`
	}
	if uErr := json.Unmarshal(b, &claim); uErr != nil {
		// Never swallow this. A shape drift between the emitter (account-service)
		// and this consumer would leave the chain nil, needsApproval false, and
		// every order for this organisation sailing through ungated — a security
		// control failing open with nothing to explain it.
		log.Printf("ERROR: approval policy claim could not be decoded, approvals will NOT be enforced for this token: %v", uErr)
		return p
	}
	p.scope = claim.Scope
	p.chain = claim.Chain
	if claim.Threshold != nil {
		p.threshold = *claim.Threshold
	}
	if claim.QuantityThreshold != nil {
		p.qtyThreshold = *claim.QuantityThreshold
	}
	if claim.ValidityHours != nil {
		p.validityHours = *claim.ValidityHours
	}
	return p
}

// buildApprovalChain returns a clean, pending copy of the configured chain for a
// given buyer.
//
// Decision fields are deliberately dropped so a chain arriving from config (or
// from a re-submitted cart) can never carry a previous run's approvals.
//
// The person the chain is being built FOR is removed from every step. One policy
// is shared by everyone in the organisation, so without this the person named as
// approver becomes their own approver the moment they act, and signs off on their
// own decision — which voids the control entirely. That is the buyer on a buyer
// chain and the approving rep on a seller chain. Steps left with no approvers are
// dropped, since nobody could ever clear them.
func buildApprovalChain(configured []quote.ApprovalStep, side, excludeAccountID string) []quote.ApprovalStep {
	if len(configured) == 0 {
		return nil
	}
	chain := make([]quote.ApprovalStep, 0, len(configured))
	for _, step := range configured {
		approvers := make([]quote.Approver, 0, len(step.Approvers))
		for _, a := range step.Approvers {
			if a.AccountID == excludeAccountID {
				continue
			}
			approvers = append(approvers, a)
		}
		if len(approvers) == 0 {
			continue
		}
		chain = append(chain, quote.ApprovalStep{
			Name:      step.Name,
			Side:      side,
			Approvers: approvers,
			Status:    quote.ApprovalStepPending,
		})
	}
	if len(chain) == 0 {
		return nil
	}
	return chain
}

func (h *LambdaHandler) handleCreateQuoteRequest(request events.APIGatewayProxyRequest, accountID, orgID string, role string, configurations []CustomerConfiguration, approval resolvedApprovalPolicy) (events.APIGatewayProxyResponse, error) {
	var req struct {
		CartID                string                  `json:"cartId"`
		SellerID              string                  `json:"sellerId"`
		AccountID             string                  `json:"accountId"`
		PaymentMethods        []string                `json:"paymentMethods"`
		DeliveryMethods       []string                `json:"deliveryMethods"`
		ShippingOutOptions    []string                `json:"shippingOutOptions"`
		CompanyLocations      []quote.CompanyLocation `json:"companyLocations"`
		CustomerAddresses     []quote.CustomerAddress `json:"customerAddresses"`
		QuoteType             string                  `json:"quoteType"`
		QuotesAllowed         bool                    `json:"quotesAllowed"`
		CreditLimit           float64                 `json:"creditLimit"`
		MinOrderAmountLimit   float64                 `json:"minOrderAmountLimit"`
		MaxOrderAmountLimit   float64                 `json:"maxOrderAmountLimit"`
		MinOrderQuantityLimit float64                 `json:"minOrderQuantityLimit"`
		MaxOrderQuantityLimit float64                 `json:"maxOrderQuantityLimit"`
		MonthlyOrderLimit     float64                 `json:"monthlyOrderLimit"`
		YearlyOrderLimit      float64                 `json:"yearlyOrderLimit"`
		TaxableGoods          *bool                   `json:"taxableGoods,omitempty"`
		TaxRate               float64                 `json:"taxRate"`
		ShippingRate          float64                 `json:"shippingRate"`
		LeadTime              float64                 `json:"leadTime"`
		PromoCode             string                  `json:"promoCode,omitempty"`
		CouponsEnabled        bool                    `json:"couponsEnabled,omitempty"`

		// No approval policy is accepted from the body. An organisation's approval
		// structure belongs to that organisation and reaches checkout only through
		// the buyer's own signed claim. A seller relaying it here could name any
		// account as an approver, and this service cannot verify membership
		// without calling account-service, which the architecture forbids.
		//
		// BuyerEmail stays: on the sales-rep path the caller is the seller, so the
		// buyer's address must come from the seller's portal for the approval
		// outcome to reach the person actually waiting on it.
		BuyerEmail string `json:"buyerEmail,omitempty"`
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}

	// Determine the effective AccountID
	effectiveAccountID := accountID
	if (role == "company" || role == "admin") && req.AccountID != "" {
		if role == "company" && req.SellerID != orgID {
			return h.errorResponse(http.StatusForbidden, "Forbidden: Company can only create quotes for its own customers."), nil
		}
		effectiveAccountID = req.AccountID
	}

	// Resolve effective config: start with company defaults, apply customer overrides from JWT
	effectiveQuotesAllowed := req.QuotesAllowed
	effectiveCreditLimit := req.CreditLimit
	effectiveMinOrderAmount := req.MinOrderAmountLimit
	effectiveMaxOrderAmount := req.MaxOrderAmountLimit
	effectiveMinOrderQty := req.MinOrderQuantityLimit
	effectiveMaxOrderQty := req.MaxOrderQuantityLimit
	effectiveMonthlyLimit := req.MonthlyOrderLimit
	effectiveYearlyLimit := req.YearlyOrderLimit
	effectiveTaxable := true // default: charge tax unless explicitly disabled
	if req.TaxableGoods != nil {
		effectiveTaxable = *req.TaxableGoods
	}
	effectiveTaxRate := req.TaxRate           // company default (from JWT), 0 if not set
	effectiveShippingRate := req.ShippingRate // company default, 0 if not set
	effectiveLeadTime := req.LeadTime

	// Approval policy from the buyer's signed claim and nowhere else. Read through
	// the same helper the place-order backstop uses, so the two paths cannot drift
	// apart the way the duplicated gating logic did.
	policy := approval
	approvalThreshold := policy.threshold
	approvalQtyThreshold := policy.qtyThreshold
	approvalValidityHours := policy.validityHours
	approvalScope := policy.scope
	approvalChain := policy.chain
	isSalesRepDraft := (role == "company" || role == "admin") && req.AccountID != ""

	// Who is waiting on the approval decision. A buyer creating their own quote
	// is the token holder; on the sales-rep path the token holder is the seller,
	// so the buyer's address has to come from the seller's portal.
	buyerEmail := h.requestUserEmail
	if isSalesRepDraft {
		buyerEmail = req.BuyerEmail
	}

	for _, config := range configurations {
		if config.CompanyID == req.SellerID {
			if config.PaymentMethods != nil {
				req.PaymentMethods = config.PaymentMethods
			}
			if config.DeliveryMethods != nil {
				req.DeliveryMethods = config.DeliveryMethods
			}
			if config.ShippingOutOptions != nil {
				req.ShippingOutOptions = config.ShippingOutOptions
			}
			if config.QuotesAllowed != nil {
				effectiveQuotesAllowed = *config.QuotesAllowed
			}
			if config.CreditLimit != nil {
				effectiveCreditLimit = *config.CreditLimit
			}
			if config.MinOrderAmountLimit != nil {
				effectiveMinOrderAmount = *config.MinOrderAmountLimit
			}
			if config.MaxOrderAmountLimit != nil {
				effectiveMaxOrderAmount = *config.MaxOrderAmountLimit
			}
			if config.MinOrderQuantityLimit != nil {
				effectiveMinOrderQty = *config.MinOrderQuantityLimit
			}
			if config.MaxOrderQuantityLimit != nil {
				effectiveMaxOrderQty = *config.MaxOrderQuantityLimit
			}
			if config.MonthlyOrderLimit != nil {
				effectiveMonthlyLimit = *config.MonthlyOrderLimit
			}
			if config.YearlyOrderLimit != nil {
				effectiveYearlyLimit = *config.YearlyOrderLimit
			}
			if config.TaxableGoods != nil {
				effectiveTaxable = *config.TaxableGoods
			}
			if config.TaxRate != nil {
				effectiveTaxRate = *config.TaxRate
			}
			if config.ShippingRate != nil {
				effectiveShippingRate = *config.ShippingRate
			}
			if config.LeadTime != nil {
				effectiveLeadTime = *config.LeadTime
			}
			break
		}
	}

	if !effectiveQuotesAllowed && req.QuoteType == "negotiable" {
		return h.errorResponse(http.StatusForbidden, "This company does not allow quote requests."), nil
	}

	cart, err := h.cartService.GetCart(effectiveAccountID, req.SellerID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "Cart not found"), nil
	}

	if len(cart.Items) == 0 {
		return h.errorResponse(http.StatusBadRequest, "Cart is empty"), nil
	}

	// Calculate totals — taxRate is a percentage (e.g., 8.25 means 8.25%)
	//
	// A tax-exempt customer stores rate 0, not "rate 8.25 with amount zeroed".
	// applyApprovedPricing recomputes tax from the STORED rate on seller approval,
	// so keeping a live rate on an exempt quote resurrected the tax — and that
	// inflated total now also feeds the approval gate and is what gets charged.
	if !effectiveTaxable {
		effectiveTaxRate = 0
	}
	taxAmount := roundCents(cart.TotalPrice * (effectiveTaxRate / 100))
	if effectiveTaxRate <= 0 {
		taxAmount = 0
	}
	shippingCost := effectiveShippingRate
	grandTotal := roundCents(cart.TotalPrice + shippingCost + taxAmount)

	// Hardcoded coupon: applies only when company has CouponsEnabled and a code was sent.
	// Effective rule mirrors taxableGoods/quotesAllowed: company default from request body,
	// per-customer override from JWT configurations (signed by account-service, not forgeable).
	// Tax computed BEFORE the discount so the merchant remits the right tax to the state.
	effectiveCouponsEnabled := req.CouponsEnabled
	for _, config := range configurations {
		if config.CompanyID == req.SellerID && config.CouponsEnabled != nil {
			effectiveCouponsEnabled = *config.CouponsEnabled
			break
		}
	}
	var promoDiscount float64
	if effectiveCouponsEnabled && req.PromoCode != "" {
		promoDiscount = roundCents(h.promotionService.ApplyPromotion(cart.TotalPrice, req.PromoCode))
		grandTotal = roundCents(grandTotal - promoDiscount)
		if grandTotal < 0 {
			grandTotal = 0
		}
	}

	// Calculate total item quantity
	var totalQuantity float64
	for _, item := range cart.Items {
		totalQuantity += float64(item.Quantity)
	}

	// Enforce order amount limits (0 = no limit)
	if effectiveMinOrderAmount > 0 && grandTotal < effectiveMinOrderAmount {
		return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("Order total $%.2f is below the minimum of $%.2f.", grandTotal, effectiveMinOrderAmount)), nil
	}
	if effectiveMaxOrderAmount > 0 && grandTotal > effectiveMaxOrderAmount {
		return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("Order total $%.2f exceeds the maximum of $%.2f.", grandTotal, effectiveMaxOrderAmount)), nil
	}

	// Enforce order quantity limits (0 = no limit)
	if effectiveMinOrderQty > 0 && totalQuantity < effectiveMinOrderQty {
		return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("Order quantity %.0f is below the minimum of %.0f.", totalQuantity, effectiveMinOrderQty)), nil
	}
	if effectiveMaxOrderQty > 0 && totalQuantity > effectiveMaxOrderQty {
		return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("Order quantity %.0f exceeds the maximum of %.0f.", totalQuantity, effectiveMaxOrderQty)), nil
	}

	// Enforce credit limit (0 = no limit)
	if effectiveCreditLimit > 0 {
		unpaidTotal, err := h.orderService.GetUnpaidOrdersTotal(effectiveAccountID, req.SellerID)
		if err != nil {
			log.Printf("Warning: Failed to check credit limit: %v", err)
		} else if unpaidTotal+grandTotal > effectiveCreditLimit {
			return h.errorResponse(http.StatusForbidden, fmt.Sprintf("Credit limit exceeded. Limit: $%.2f, Outstanding: $%.2f, This order: $%.2f.", effectiveCreditLimit, unpaidTotal, grandTotal)), nil
		}
	}

	// Enforce monthly order limit (0 = no limit)
	if effectiveMonthlyLimit > 0 {
		now := time.Now()
		monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		count, err := h.orderService.CountOrdersSince(effectiveAccountID, req.SellerID, monthStart)
		if err != nil {
			log.Printf("Warning: Failed to check monthly order limit: %v", err)
		} else if float64(count) >= effectiveMonthlyLimit {
			return h.errorResponse(http.StatusForbidden, fmt.Sprintf("Monthly order limit of %.0f reached.", effectiveMonthlyLimit)), nil
		}
	}

	// Enforce yearly order limit (0 = no limit)
	if effectiveYearlyLimit > 0 {
		now := time.Now()
		yearStart := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
		count, err := h.orderService.CountOrdersSince(effectiveAccountID, req.SellerID, yearStart)
		if err != nil {
			log.Printf("Warning: Failed to check yearly order limit: %v", err)
		} else if float64(count) >= effectiveYearlyLimit {
			return h.errorResponse(http.StatusForbidden, fmt.Sprintf("Yearly order limit of %.0f reached.", effectiveYearlyLimit)), nil
		}
	}

	// Buyer-side approval gate (Roadmap #21).
	//
	// The role check is the guard that keeps D2C safe. A b2c storefront shopper
	// reaches this same endpoint (templates/customer.js posts quoteType:"standard"),
	// and the storefront has no approval UI, so gating one would dead-end a real
	// sale. account-service already withholds the claim from b2c tokens; this
	// refuses to act on it regardless, because access tokens live 72h and outlive
	// a config change. A quote drafted BY a rep FOR a buyer still gates: the
	// buyer, not the rep, is the one whose policy applies.
	// On the sales-rep path the buyer is someone else, so their role has to come
	// from the seller's own portal. Requiring it to be "customer" keeps a D2C
	// shopper from being gated when an admin drafts an order for them — the same
	// protection the JWT path gets from its own role check.
	// Only a signed customer claim can gate. A rep-drafted quote carries no buyer
	// claim, so it is not gated at creation.
	approvalEligible := role == "customer"

	// Build the chain FIRST, so the buyer is already excluded before any
	// threshold decision, and so an ineligible buyer never gets a chain
	// persisted onto their quote. Persisting one regardless would let the
	// seller-approve gate (which re-checks chain presence, not role) strand a
	// b2c buyer at pending_approval with no way to pay.
	//
	// The THRESHOLDS go with it. `approval` is whatever the CALLER's token
	// carries, and on the sales-rep path the caller is the seller, so their own
	// #21d policy would otherwise be persisted into fields that ShouldGate reads
	// as the buyer's. Inert only while the chain is empty — the moment a seller
	// chain lands on the quote, the seller's threshold would fire a buyer gate the
	// buyer never configured.
	var chain []quote.ApprovalStep
	if !approvalEligible {
		approvalScope = ""
		approvalThreshold = 0
		approvalQtyThreshold = 0
		approvalValidityHours = 0
	}
	if approvalEligible {
		chain = buildApprovalChain(approvalChain, quote.ApprovalSideBuyer, effectiveAccountID)
		if len(approvalChain) > 0 && len(chain) == 0 {
			// Every configured approver was the buyer themselves. Proceeding
			// ungated is the only functional option (nobody is left who could
			// approve), but it is a misconfiguration worth surfacing.
			log.Printf("WARN: approval chain for buyer %s at seller %s contains only the buyer; order proceeds ungated",
				effectiveAccountID, req.SellerID)
		}
	}

	// Same predicate the seller-approve path uses, asked of a candidate carrying
	// this checkout's money and policy. Keeping the rule in one function is what
	// stops the two paths drifting apart.
	candidate := &quote.Quote{
		Items:                     cart.Items,
		GrandTotal:                grandTotal,
		ApprovalScope:             approvalScope,
		ApprovalThreshold:         approvalThreshold,
		ApprovalQuantityThreshold: approvalQtyThreshold,
		ApprovalChain:             chain,
	}
	needsApproval := approvalEligible && candidate.ShouldGate(req.QuoteType)

	// A gated order the buyer can never be told about is not a workable order:
	// the approval outcome email is their only signal, and on the sales-rep path
	// nothing else notifies them at all. Refuse rather than persist a blank one.
	if needsApproval && buyerEmail == "" {
		return h.errorResponse(http.StatusBadRequest,
			"This order requires approval, but no buyer email was supplied to notify them of the outcome."), nil
	}

	initialStatus := "draft"
	if req.QuoteType == "standard" {
		initialStatus = "approved"
		if needsApproval {
			// Blocks payment for free: handlePlaceOrderRequest already refuses any
			// status that is not "approved".
			initialStatus = quote.StatusPendingApproval
		}
	}

	// Only stamp the window when the chain STARTS NOW, i.e. a standard checkout
	// held on the spot. A negotiable quote's chain does not begin until the
	// seller approves (SendForApproval stamps it then), so the quoteType check
	// is load-bearing: needsApproval alone is true for a negotiable quote whose
	// scope covers it, and would start the clock during the negotiation.
	var approvalExpiresAt *time.Time
	if needsApproval && req.QuoteType == "standard" {
		hours := approvalValidityHours
		if hours <= 0 {
			hours = quote.DefaultApprovalValidityHours
		}
		exp := time.Now().Add(time.Duration(hours * float64(time.Hour)))
		approvalExpiresAt = &exp
	}

	newQuote := &quote.Quote{
		CartID:                      cart.ID,
		AccountID:                   effectiveAccountID,
		SellerID:                    req.SellerID,
		Items:                       cart.Items,
		Subtotal:                    cart.TotalPrice,
		ShippingCost:                shippingCost,
		ShippingRate:                effectiveShippingRate,
		TaxAmount:                   taxAmount,
		TaxRate:                     effectiveTaxRate,
		GrandTotal:                  grandTotal,
		AvailablePaymentMethods:     req.PaymentMethods,
		AvailableDeliveryMethods:    req.DeliveryMethods,
		AvailableShippingOutOptions: req.ShippingOutOptions,
		CompanyLocations:            req.CompanyLocations,
		CustomerAddresses:           req.CustomerAddresses,
		QuoteType:                   req.QuoteType,
		Status:                      initialStatus,
		LeadTime:                    effectiveLeadTime,
		PromoCode:                   req.PromoCode,
		PromoDiscount:               promoDiscount,
		ApprovalScope:               approvalScope,
		ApprovalThreshold:           approvalThreshold,
		ApprovalQuantityThreshold:   approvalQtyThreshold,
		ApprovalExpiresAt:           approvalExpiresAt,
		ApprovalStage:               0,
		ApprovalChain:               chain,
		ApprovalRequired:            needsApproval && req.QuoteType == "standard",
		ApprovalValidityHours:       approvalValidityHours,
		CustomerEmail:               buyerEmail,
	}

	// A standard quote upserts in place, so re-checking-out re-sends the approval
	// request. Read the prior state ONLY when the gate is about to fire (a rare
	// path) so an unchanged resubmission does not spam approvers, while ordinary
	// checkout keeps its single write with no extra round trip.
	var prior *quote.Quote
	if needsApproval && req.QuoteType == "standard" {
		if quotes, pErr := h.quoteService.GetQuotesByAccountID(context.Background(), effectiveAccountID, req.SellerID); pErr == nil {
			for i, p := range quotes {
				// The accountId match is essential: this query also returns quotes
				// this account merely APPROVES, so without it a colleague's
				// standard quote could stand in as "prior" and suppress a
				// notification that genuinely needed sending.
				if p.QuoteType == "standard" && p.AccountID == effectiveAccountID {
					prior = &quotes[i]
					break
				}
			}
		}
	}

	createdQuote, err := h.quoteService.CreateQuote(newQuote)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to create or update quote"), nil
	}

	// Approval gate fired at create time: pull in the first tier of approvers.
	// Editing the cart resets the chain to stage 0 above, so a genuine change
	// must re-notify. An identical resubmission (same total, already awaiting the
	// same approvers) must not.
	if createdQuote.Status == quote.StatusPendingApproval {
		// Suppress ONLY a genuinely identical resubmission. The stage check is
		// what makes this safe: the rebuilt chain always restarts at 0, so if the
		// previous one had already cleared a level, that approval was just
		// discarded and those approvers must be asked again. Comparing the total
		// alone would silently drop that notification and stall the order.
		unchanged := prior != nil &&
			prior.Status == quote.StatusPendingApproval &&
			prior.ApprovalStage == 0 &&
			math.Abs(prior.GrandTotal-createdQuote.GrandTotal) < 0.005 &&
			sameCurrentApprovers(prior, createdQuote)
		if !unchanged {
			h.notifyCurrentApprovers(createdQuote)
		}
	}

	// Quote-requested email — synchronous so it actually delivers (same Lambda
	// goroutine-vs-freeze issue as order confirmation). Customer-facing → routes
	// through company's SMTP for branding.
	if h.emailSender != nil && h.requestUserEmail != "" && req.QuoteType == "negotiable" && role == "customer" {
		brandName, brandEmail := mailer.CompanyBrand(createdQuote.SellerID)
		msg := mailer.QuoteRequestedMessage(h.requestUserEmail, mailer.QuoteRequestedData{
			QuoteID:    createdQuote.ID.Hex(),
			BrandName:  brandName,
			BrandEmail: brandEmail,
		})
		sender, _ := mailer.SenderForCompany(context.Background(), createdQuote.SellerID, h.emailSender)
		if err := sender.Send(context.Background(), msg); err != nil {
			log.Printf("WARN: quote requested email failed for %s: %v", h.requestUserEmail, err)
		}
	}

	// Redacted like every other quote response. A standard quote is upserted with
	// NO status constraint, so a re-submission returns a document that may already
	// carry a decision record; on the sales-rep path the caller is the SELLER, and
	// that record is the buyer's. This was the one response path that skipped it.
	respBody, _ := json.Marshal(redactQuoteFor(createdQuote, role))
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}, nil
}

func (h *LambdaHandler) handleCartRequest(request events.APIGatewayProxyRequest, accountID string, role string, associateCompanyIDs []string) (events.APIGatewayProxyResponse, error) {
	headers := corsHeaders(h.requestOrigin)

	effectiveAccountID := accountID
	// For company/admin roles, allow specifying a customer account ID
	if role == "company" || role == "admin" {
		if customerAccountID, ok := request.QueryStringParameters["accountId"]; ok && customerAccountID != "" {
			effectiveAccountID = customerAccountID
			// Optional: Add authorization check here to ensure the company is allowed to modify this customer's cart.
		}
	}
	log.Printf("handleCartRequest: effectiveAccountID=%s, role=%s", effectiveAccountID, role)

	switch request.HTTPMethod {
	case "POST": // Add item to cart
		var req CartItemRequest
		if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
		}

		// Saved Cart (Requisition List) actions reuse this endpoint (no new route/CDK).
		if req.SavedListAction != "" {
			sellerID := req.SellerID
			if sellerID == "" {
				sellerID = req.Entity.SellerID
			}
			if sellerID == "" {
				return h.errorResponse(http.StatusBadRequest, "Seller ID is required"), nil
			}
			switch req.SavedListAction {
			case "save":
				if req.SavedListName == "" {
					return h.errorResponse(http.StatusBadRequest, "List name is required"), nil
				}
				if err := h.cartService.SaveList(effectiveAccountID, sellerID, req.SavedListName); err != nil {
					return h.errorResponse(http.StatusBadRequest, err.Error()), nil
				}
			case "delete":
				if err := h.cartService.DeleteList(effectiveAccountID, sellerID, req.SavedListName); err != nil {
					return h.errorResponse(http.StatusInternalServerError, "Failed to delete saved cart"), nil
				}
			case "load":
				// Frontend sends fresh, re-resolved items; replace the main cart in one call.
				loadedCart, err := h.cartService.GetCart(effectiveAccountID, sellerID)
				if err != nil {
					loadedCart = &cart.Cart{AccountID: effectiveAccountID, SellerID: sellerID, Items: []cart.CartItem{}}
				}
				for i := range req.Items {
					if req.Items[i].ID.IsZero() {
						req.Items[i].ID = primitive.NewObjectID()
					}
				}
				loadedCart.Items = req.Items
				if err := h.cartService.SaveCart(loadedCart); err != nil {
					return h.errorResponse(http.StatusInternalServerError, "Failed to load saved cart"), nil
				}
			default:
				return h.errorResponse(http.StatusBadRequest, "Unknown savedListAction"), nil
			}
			updated, _ := h.cartService.GetCart(effectiveAccountID, sellerID)
			respBody, _ := json.Marshal(updated)
			return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Headers: headers, Body: string(respBody)}, nil
		}

		if req.Entity.Quantity <= 0 {
			return h.errorResponse(http.StatusBadRequest, "Quantity must be greater than 0"), nil
		}
		currentCart, err := h.cartService.GetCart(effectiveAccountID, req.Entity.SellerID)
		if err != nil && err.Error() != "cart not found" {
			return h.errorResponse(http.StatusInternalServerError, "Failed to get cart"), nil
		}
		if currentCart == nil {
			currentCart = &cart.Cart{
				AccountID: effectiveAccountID,
				SellerID:  req.Entity.SellerID,
				Items:     []cart.CartItem{},
			}
		}

		found := false
		for i, item := range currentCart.Items {
			if item.ProductID == req.Entity.ProductID && item.SellerID == req.Entity.SellerID {
				currentCart.Items[i].Quantity += req.Entity.Quantity
				found = true
				break
			}
		}
		if !found {
			req.Entity.ID = primitive.NewObjectID() // Assign a new ObjectID for the new item
			currentCart.Items = append(currentCart.Items, req.Entity)
		}

		if err := h.cartService.SaveCart(currentCart); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to save cart"), nil
		}
		respBody, _ := json.Marshal(currentCart)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       string(respBody),
		}, nil

	case "GET": // Get cart
		sellerID := request.QueryStringParameters["sellerId"]
		if sellerID == "" {
			return h.errorResponse(http.StatusBadRequest, "Seller ID is required"), nil
		}

		// Authorization check for customer role
		if role == "customer" || role == "b2c" {
			can_access := false
			for _, id := range associateCompanyIDs {
				if id == sellerID {
					can_access = true
					break
				}
			}
			if !can_access {
				return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
			}
		}

		fetchedCart, err := h.cartService.GetCart(effectiveAccountID, sellerID)
		if err != nil {
			if err.Error() == "cart not found" {
				// Return an empty cart if not found, as per previous cart-service behavior
				emptyCart := cart.Cart{AccountID: effectiveAccountID, SellerID: sellerID, Items: []cart.CartItem{}, TotalPrice: 0}
				respBody, _ := json.Marshal(emptyCart)
				return events.APIGatewayProxyResponse{
					StatusCode: http.StatusOK,
					Headers:    headers,
					Body:       string(respBody),
				}, nil
			}
			return h.errorResponse(http.StatusInternalServerError, "Failed to get cart"), nil
		}
		respBody, _ := json.Marshal(fetchedCart)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    headers,
			Body:       string(respBody),
		}, nil

	case "PUT": // Update item quantity
		itemId := request.PathParameters["itemId"]
		sellerID := request.QueryStringParameters["sellerId"]
		if itemId == "" || sellerID == "" {
			return h.errorResponse(http.StatusBadRequest, "Item ID and Seller ID are required"), nil
		}
		var req CartItemRequest
		if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
		}

		objID, err := primitive.ObjectIDFromHex(itemId)
		if err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid item ID format"), nil
		}

		if req.Entity.Quantity <= 0 {
			return h.errorResponse(http.StatusBadRequest, "Quantity must be greater than 0"), nil
		}
		currentCart, err := h.cartService.GetCart(effectiveAccountID, sellerID)
		if err != nil {
			return h.errorResponse(http.StatusNotFound, "Cart not found"), nil
		}

		found := false
		for i, item := range currentCart.Items {
			if item.ID == objID {
				currentCart.Items[i].Quantity = req.Entity.Quantity
				if req.Entity.Price > 0 {
					currentCart.Items[i].Price = req.Entity.Price
				}
				if req.Entity.DiscountedPrice > 0 {
					currentCart.Items[i].DiscountedPrice = req.Entity.DiscountedPrice
				}
				found = true
				break
			}
		}
		if !found {
			return h.errorResponse(http.StatusNotFound, "Item not found in cart"), nil
		}

		if err := h.cartService.SaveCart(currentCart); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to update cart item"), nil
		}
		respBody, _ := json.Marshal(currentCart)
		return events.APIGatewayProxyResponse{
				StatusCode: http.StatusOK,
				Headers:    headers,
				Body:       string(respBody),
			},
			nil

	case "DELETE": // Remove item or clear cart
		itemId, hasItemId := request.PathParameters["itemId"]

		if hasItemId && itemId != "" { // Remove specific item
			sellerID := request.QueryStringParameters["sellerId"]
			if sellerID == "" {
				return h.errorResponse(http.StatusBadRequest, "Seller ID is required"), nil
			}

			objID, err := primitive.ObjectIDFromHex(itemId)
			if err != nil {
				return h.errorResponse(http.StatusBadRequest, "Invalid item ID format"), nil
			}

			currentCart, err := h.cartService.GetCart(effectiveAccountID, sellerID)
			if err != nil {
				return h.errorResponse(http.StatusNotFound, "Cart not found"), nil
			}

			newItems := []cart.CartItem{}
			found := false
			for _, item := range currentCart.Items {
				if item.ID != objID {
					newItems = append(newItems, item)
				} else {
					found = true
				}
			}
			if !found {
				return h.errorResponse(http.StatusNotFound, "Item not found in cart"), nil
			}
			currentCart.Items = newItems

			if err := h.cartService.SaveCart(currentCart); err != nil {
				return h.errorResponse(http.StatusInternalServerError, "Failed to remove cart item"), nil
			}
			respBody, _ := json.Marshal(currentCart)
			return events.APIGatewayProxyResponse{
					StatusCode: http.StatusOK,
					Headers:    headers,
					Body:       string(respBody),
				},
				nil

		} else if request.Path == "/checkout/cart" { // Clear entire cart
			sellerID := request.QueryStringParameters["sellerId"]
			if sellerID == "" {
				return h.errorResponse(http.StatusBadRequest, "Seller ID is required"), nil
			}
			if err := h.cartService.ClearCart(effectiveAccountID, sellerID); err != nil {
				return h.errorResponse(http.StatusInternalServerError, "Failed to clear cart"), nil
			}
			emptyCart := cart.Cart{AccountID: effectiveAccountID, SellerID: sellerID, Items: []cart.CartItem{}, TotalPrice: 0}
			respBody, _ := json.Marshal(emptyCart)
			return events.APIGatewayProxyResponse{
					StatusCode: http.StatusOK,
					Headers:    headers,
					Body:       string(respBody),
				},
				nil
		}
		return h.errorResponse(http.StatusBadRequest, "Invalid cart delete request"), nil

	default:
		return h.errorResponse(http.StatusMethodNotAllowed, "Method not allowed"), nil
	}
}

func (h *LambdaHandler) errorResponse(statusCode int, message string) events.APIGatewayProxyResponse {
	respBody, _ := json.Marshal(map[string]string{"message": message})
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}
}

func (h *LambdaHandler) successResponse(data interface{}) events.APIGatewayProxyResponse {
	respBody, _ := json.Marshal(data)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(respBody),
	}
}

func (h *LambdaHandler) redirectResponse(redirectURL string) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{
		StatusCode: 302,
		Headers: map[string]string{
			"Location": redirectURL,
		},
	}, nil
}

func isAllowedReturnURL(rawURL string) bool {
	if rawURL == "" {
		return false
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	// Allow businesscart.ai and all subdomains
	if host == "businesscart.ai" || strings.HasSuffix(host, ".businesscart.ai") {
		return true
	}
	// Allow localhost for development
	if host == "localhost" || host == "127.0.0.1" {
		return true
	}
	return false
}

func (h *LambdaHandler) handleAmazonPayInitRequest(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	checkoutSessionID := request.QueryStringParameters["checkoutSessionId"]
	merchantID := request.QueryStringParameters["merchantId"]
	sandbox := request.QueryStringParameters["sandbox"] == "true"
	currency := request.QueryStringParameters["currency"]
	if currency == "" {
		currency = "USD"
	}

	if checkoutSessionID == "" || merchantID == "" {
		return h.errorResponse(http.StatusBadRequest, "Missing required parameters"), nil
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redirecting to Amazon Pay</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.c{text-align:center;padding:2rem}.sp{width:40px;height:40px;border:4px solid #ddd;border-top:4px solid #f90;border-radius:50%%;animation:s 1s linear infinite;margin:0 auto 1rem}
@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="c"><div class="sp"></div><p>Redirecting to Amazon Pay...</p></div>
<script src="https://static-na.payments-amazon.com/checkout.js"></script>
<script>
amazon.Pay.initCheckout({merchantId:'%s',ledgerCurrency:'%s',sandbox:%t,
checkoutSessionId:'%s',productType:'PayOnly',placement:'Checkout'});
</script></body></html>`, merchantID, currency, sandbox, checkoutSessionID)

	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    map[string]string{"Content-Type": "text/html; charset=utf-8"},
		Body:       html,
	}, nil
}

func buildRedirectURL(base, status, orderID string) string {
	u, err := url.Parse(base)
	if err != nil {
		return base + "?status=" + status
	}
	q := u.Query()
	q.Set("status", status)
	if orderID != "" {
		q.Set("orderId", orderID)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// --- Gateway Config CRUD (company/admin only) ---

func (h *LambdaHandler) handleGatewayRequest(request events.APIGatewayProxyRequest, accountID, orgID, role, orgRole string) (events.APIGatewayProxyResponse, error) {
	if role != "company" && role != "admin" {
		return h.errorResponse(http.StatusForbidden, "Only company or admin can manage gateways"), nil
	}
	// Payment credentials are the keys to the business's money: a colleague who
	// can rewrite the gateway secret can redirect every payment the store takes.
	if msg := notOrgOwner(role, orgRole, "Payment gateway settings are managed by the account owner."); msg != "" {
		return h.errorResponse(http.StatusForbidden, msg), nil
	}
	if h.gatewayStore == nil {
		return h.errorResponse(http.StatusServiceUnavailable, "Gateway service not configured"), nil
	}

	parts := strings.Split(request.Path, "/")
	if len(parts) < 4 {
		return h.errorResponse(http.StatusBadRequest, "Seller ID required"), nil
	}
	sellerID := parts[3]

	if role == "company" && sellerID != orgID {
		return h.errorResponse(http.StatusForbidden, "Cannot manage gateways for another company"), nil
	}

	ctx := context.Background()

	switch request.HTTPMethod {
	case "PUT":
		var req struct {
			Gateway            string            `json:"gateway"`
			DisplayName        string            `json:"displayName"`
			Credentials        map[string]string `json:"credentials"`
			SandboxCredentials map[string]string `json:"sandboxCredentials"`
			Sandbox            bool              `json:"sandbox"`
		}
		if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
		}

		if req.Gateway == "" {
			return h.errorResponse(http.StatusBadRequest, "gateway is required"), nil
		}

		// Validate credentials with the gateway implementation
		gw, ok := h.gatewayRegistry.Get(req.Gateway)
		if ok {
			if len(req.Credentials) > 0 {
				if err := gw.ValidateCredentials(req.Credentials); err != nil {
					return h.errorResponse(http.StatusBadRequest, "Invalid production credentials: "+err.Error()), nil
				}
			}
			if len(req.SandboxCredentials) > 0 {
				if err := gw.ValidateCredentials(req.SandboxCredentials); err != nil {
					return h.errorResponse(http.StatusBadRequest, "Invalid sandbox credentials: "+err.Error()), nil
				}
			}
		}

		config := &gateway.GatewayConfig{
			SellerID:           sellerID,
			Gateway:            req.Gateway,
			DisplayName:        req.DisplayName,
			Credentials:        req.Credentials,
			SandboxCredentials: req.SandboxCredentials,
			Sandbox:            req.Sandbox,
		}
		if err := h.gatewayStore.SaveConfig(ctx, config); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to save gateway config"), nil
		}

		return h.successResponse(map[string]string{"message": "Gateway configured successfully"}), nil

	case "GET":
		configs, err := h.gatewayStore.ListConfigs(ctx, sellerID)
		if err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to list gateway configs"), nil
		}
		return h.successResponse(configs), nil

	case "DELETE":
		if len(parts) < 5 {
			return h.errorResponse(http.StatusBadRequest, "Gateway name required in path"), nil
		}
		gatewayName := parts[4]
		if err := h.gatewayStore.DeleteConfig(ctx, sellerID, gatewayName); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to delete gateway config"), nil
		}
		return h.successResponse(map[string]string{"message": "Gateway removed"}), nil
	}

	return h.errorResponse(http.StatusMethodNotAllowed, "Method not allowed"), nil
}

// --- Payment Return (browser redirect from payment provider, NO JWT) ---

func (h *LambdaHandler) handlePaymentReturnRequest(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if h.gatewayStore == nil {
		return h.errorResponse(http.StatusServiceUnavailable, "Gateway service not configured"), nil
	}

	ctx := context.Background()

	// Amazon Pay button flow uses "psid" (our session ID) + "amazonCheckoutSessionId" (Amazon's ID)
	// Stripe/Authorize.net use "sessionId" (provider's session ID which is also our providerSessionId)
	providerSessionID := request.QueryStringParameters["psid"]
	amazonCheckoutSessionID := request.QueryStringParameters["amazonCheckoutSessionId"]
	if providerSessionID == "" {
		providerSessionID = request.QueryStringParameters["amazonCheckoutSessionId"]
	}
	if providerSessionID == "" {
		providerSessionID = request.QueryStringParameters["sessionId"]
	}
	if providerSessionID == "" {
		return h.errorResponse(http.StatusBadRequest, "Missing payment session ID"), nil
	}

	// Handle user-cancelled payments (e.g., Stripe cancel button)
	if request.QueryStringParameters["cancelled"] == "true" {
		session, err := h.gatewayStore.GetSessionByProviderID(ctx, providerSessionID)
		if err == nil && session.Status == "pending" {
			_ = h.gatewayStore.UpdateSessionStatus(ctx, session.ID, "cancelled")
		}
		cancelURL := ""
		if session != nil && session.ReturnURL != "" {
			cancelURL = session.ReturnURL
		}
		if cancelURL == "" && session != nil && session.RedirectURL != "" {
			cancelURL = session.RedirectURL
		}
		if cancelURL == "" {
			return h.errorResponse(http.StatusBadRequest, "Payment cancelled but no return URL available"), nil
		}
		return h.redirectResponse(buildRedirectURL(cancelURL, "cancelled", ""))
	}

	// First check if session exists and get returnURL for error redirects
	existingSession, err := h.gatewayStore.GetSessionByProviderID(ctx, providerSessionID)
	if err != nil {
		log.Printf("Payment session not found for provider ID %s: %v", providerSessionID, err)
		return h.errorResponse(http.StatusNotFound, "Payment session not found"), nil
	}

	// Already processed — redirect to result (idempotent)
	if existingSession.Status != "pending" {
		return h.redirectResponse(buildRedirectURL(existingSession.ReturnURL, existingSession.Status, ""))
	}

	// Check expiry before processing
	if time.Now().After(existingSession.ExpiresAt) {
		_ = h.gatewayStore.UpdateSessionStatus(ctx, existingSession.ID, "expired")
		return h.redirectResponse(buildRedirectURL(existingSession.ReturnURL, "expired", ""))
	}

	// Atomically claim the session (pending → processing) to prevent duplicate orders
	paymentSession, err := h.gatewayStore.ClaimSession(ctx, providerSessionID)
	if err != nil {
		// Another request already claimed it — redirect as already processed
		return h.redirectResponse(buildRedirectURL(existingSession.ReturnURL, "completed", ""))
	}

	// Get seller's gateway config
	gatewayConfig, err := h.gatewayStore.GetConfig(ctx, paymentSession.SellerID, paymentSession.PaymentMethod)
	if err != nil {
		log.Printf("Gateway config not found for seller %s, method %s: %v", paymentSession.SellerID, paymentSession.PaymentMethod, err)
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "failed", ""))
	}

	gw, ok := h.gatewayRegistry.Get(paymentSession.PaymentMethod)
	if !ok {
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "failed", ""))
	}

	// Select credentials without mutating the original map
	credentials := gatewayConfig.Credentials
	sandbox := gatewayConfig.Sandbox
	if sandbox {
		credentials = gatewayConfig.SandboxCredentials
	}

	// Complete the payment with the provider
	// For Amazon Pay button flow, use Amazon's checkout session ID for the API call
	completeSessionID := providerSessionID
	if amazonCheckoutSessionID != "" {
		completeSessionID = amazonCheckoutSessionID
	}
	completion, err := gw.CompleteSession(ctx, completeSessionID, paymentSession.InvoiceRef, paymentSession.Amount, paymentSession.Currency, credentials, sandbox)
	if err != nil {
		log.Printf("Gateway CompleteSession failed: %v", err)
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "failed", ""))
	}

	if completion.Status != "completed" {
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "failed", ""))
	}

	// Payment successful — create order from quote
	quoteID, err := primitive.ObjectIDFromHex(paymentSession.QuoteID)
	if err != nil {
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "error", ""))
	}

	q, err := h.quoteService.GetQuote(quoteID)
	if err != nil {
		log.Printf("Quote %s not found during payment return: %v", paymentSession.QuoteID, err)
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "error", ""))
	}

	// Verify quote amount matches what was charged (compare as cents to avoid float precision issues)
	if int(math.Round(q.GrandTotal*100)) != int(math.Round(paymentSession.Amount*100)) {
		log.Printf("Amount mismatch: quote=%.2f, charged=%.2f for session %s", q.GrandTotal, paymentSession.Amount, providerSessionID)
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "error", ""))
	}

	resp, _ := h.createOrderFromQuote(q, paymentSession.AccountID, paymentSession.CustomerEmail, paymentSession.PaymentMethod, paymentSession.DeliveryMethod, completion.TransactionID, paymentSession.PickupLocationID, paymentSession.DeliveryAddressID, paymentSession.VisitorID, paymentSession.ClickIDs)

	if resp.StatusCode != http.StatusOK {
		log.Printf("Order creation failed after successful payment for session %s: %s", providerSessionID, resp.Body)
		_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "failed")
		return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "error", ""))
	}

	_ = h.gatewayStore.UpdateSessionStatus(ctx, paymentSession.ID, "completed")

	var orderResult map[string]interface{}
	orderID := ""
	if err := json.Unmarshal([]byte(resp.Body), &orderResult); err == nil {
		if id, ok := orderResult["id"].(string); ok {
			orderID = id
		}
	}

	return h.redirectResponse(buildRedirectURL(paymentSession.ReturnURL, "success", orderID))
}
