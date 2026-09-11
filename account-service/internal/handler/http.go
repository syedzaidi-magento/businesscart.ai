package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode"

	"business-cart/account-service/internal/auth"
	"business-cart/account-service/internal/conversion"
	mailer "business-cart/account-service/internal/email"
	"business-cart/account-service/internal/generator"
	"business-cart/account-service/internal/storage"

	"context"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cloudfront"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// MaxCustomerGroups is the hard limit on customer groups per company.
// Frontend mirrors this constant — both sides validate without an API call.
const MaxCustomerGroups = 5

type LambdaHandler struct {
	db                *storage.DB
	jwtSecret         string
	jwtRefreshSecret  string
	d2cBucketName     string
	d2cDistributionId string
	emailSender       mailer.Sender
	requestOrigin     string // set per-request from Origin header
	conversions       *conversion.Service
	convCache         *conversion.ConfigCache
	convKey           []byte // dedicated AES key from CONVERSION_ENCRYPTION_KEY; nil = disabled
}

func NewLambdaHandler(db *storage.DB, jwtSecret, jwtRefreshSecret, d2cBucketName, d2cDistributionId, conversionEncryptionKey string, emailSender mailer.Sender) *LambdaHandler {
	// Server-side ad-conversion dispatcher, gated on a dedicated encryption key
	// (mirrors the payment gateway: GATEWAY_ENCRYPTION_KEY). If the key is unset
	// or malformed, conversion tracking is disabled — no JWT-derived fallback.
	var convKey []byte
	var conversions *conversion.Service
	if conversionEncryptionKey == "" {
		log.Println("WARNING: CONVERSION_ENCRYPTION_KEY not set. Ad-conversion tracking disabled.")
	} else if k, err := conversion.ParseKey(conversionEncryptionKey); err != nil {
		log.Printf("WARNING: CONVERSION_ENCRYPTION_KEY invalid, ad-conversion tracking disabled: %v", err)
	} else {
		convKey = k
		convRegistry := conversion.NewRegistry()
		convRegistry.Register(conversion.NewMetaDispatcher())
		convRegistry.Register(conversion.NewGoogleDispatcher())
		conversions = conversion.NewService(convRegistry, convKey)
		log.Println("Ad-conversion tracking initialized.")
	}

	return &LambdaHandler{
		db:                db,
		jwtSecret:         jwtSecret,
		jwtRefreshSecret:  jwtRefreshSecret,
		d2cBucketName:     d2cBucketName,
		d2cDistributionId: d2cDistributionId,
		emailSender:       emailSender,
		conversions:       conversions,
		convKey:           convKey,
		// Warm-container cache of per-seller enabled creds; collapses the
		// per-event account read to ~one DB hit per seller per TTL.
		convCache: conversion.NewConfigCache(5 * time.Minute),
	}
}

func (h *LambdaHandler) HandleRequest(request events.APIGatewayProxyRequest) (resp events.APIGatewayProxyResponse, err error) {
	// Panic recover with admin alert. Without this, a panic kills the Lambda
	// invocation silently from the operator's perspective (just a 500 from API
	// Gateway with no signal). Email goes through the dedup'd NotifyAdmin so a
	// repeating panic does not flood the inbox.
	defer func() {
		if r := recover(); r != nil {
			// Subject keyed on Resource (bounded route template like
			// /accounts/{id}), not Path (contains unique IDs). Without this,
			// the dedup map grows once per unique URL and leaks memory over
			// Lambda container lifetime. Body keeps the actual path for debug.
			body := fmt.Sprintf("path=%s method=%s\npanic=%v", request.Path, request.HTTPMethod, r)
			mailer.NotifyAdmin(h.emailSender, "panic in account-service: "+request.Resource, body)
			log.Printf("PANIC in HandleRequest path=%s: %v", request.Path, r)
			resp = h.errorResponse(http.StatusInternalServerError, "Internal server error")
			err = nil
		}
	}()

	h.requestOrigin = request.Headers["origin"]
	if h.requestOrigin == "" {
		h.requestOrigin = request.Headers["Origin"]
	}

	if request.HTTPMethod == "OPTIONS" {
		return h.successResponse(nil, http.StatusOK), nil
	}

	// Public routes that do not require JWT authentication
	switch request.Path {
	case "/accounts/register":
		if request.HTTPMethod == "POST" {
			return h.register(request)
		}
	case "/accounts/login":
		if request.HTTPMethod == "POST" {
			return h.login(request)
		}
	case "/accounts/refresh":
		if request.HTTPMethod == "POST" {
			return h.refreshToken(request)
		}
	case "/accounts/logout":
		if request.HTTPMethod == "POST" {
			return h.logoutUser(request)
		}
	case "/accounts/forgot-password":
		if request.HTTPMethod == "POST" {
			return h.forgotPassword(request)
		}
	case "/accounts/reset-password":
		if request.HTTPMethod == "POST" {
			return h.resetPassword(request)
		}
	case "/visitors/event":
		if request.HTTPMethod == "POST" {
			return h.trackVisitorEvent(request)
		}
	}

	// Protected routes requiring JWT authentication
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

	// --- Route protected requests ---
	if strings.HasPrefix(request.Path, "/accounts/locations") {
		return h.handleLocations(userClaim, request)
	}
	if strings.HasPrefix(request.Path, "/accounts") {
		return h.handleAccounts(userClaim, request)
	}
	if strings.HasPrefix(request.Path, "/codes") {
		return h.handleCodes(userClaim, request)
	}
	if strings.HasPrefix(request.Path, "/customers") {
		return h.handleCustomers(userClaim, request)
	}
	if strings.HasPrefix(request.Path, "/visitors") {
		return h.handleVisitors(userClaim, request)
	}

	return h.errorResponse(http.StatusNotFound, "Route not found"), nil
}

// newOrgInviteCode mints a join code for an organisation.
//
// Long and random because it is multi-use and, unlike the admin-issued company
// and customer codes, it is handed out by the organisation itself: anyone
// holding it can join and inherit that organisation's view of its data.
func newOrgInviteCode() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "ORG-" + strings.ToUpper(hex.EncodeToString(b)), nil
}

// orgIDFromClaim resolves the organisation a caller acts within (Roadmap #21c).
//
// Seller-scoped records are keyed by the ROOT account's id, so lookups must use
// this rather than the caller's own id — otherwise a second account in the same
// organisation resolves an empty result set. Tokens minted before this claim
// existed, and any account without a parent, fall back to the account's own id,
// so behaviour is unchanged until a parent is actually assigned.
func orgIDFromClaim(userClaim map[string]interface{}) string {
	if org, _ := userClaim["org_id"].(string); org != "" {
		return org
	}
	id, _ := userClaim["id"].(string)
	return id
}

// resolveFloat returns the customer override if set, else the company default (nil if zero).
func resolveFloat(companyDefault float64, customerOverride *float64) *float64 {
	if customerOverride != nil {
		return customerOverride
	}
	if companyDefault != 0 {
		return &companyDefault
	}
	return nil
}

// override safely extracts a *float64 field from a possibly-nil CustomerConfiguration.
func override(cfg *storage.CustomerConfiguration, getter func(*storage.CustomerConfiguration) *float64) *float64 {
	if cfg == nil {
		return nil
	}
	return getter(cfg)
}

// trimChainForClaim strips display-only fields from a chain before it goes into
// the JWT.
//
// The chain travels in the Authorization header of every request the account
// makes. It is carried once per token rather than once per attached company since
// #21d, which removed the worst of the growth, but at the configured caps
// (5 levels x 10 approvers) the names alone still run to hundreds of bytes on a
// header with a hard API Gateway limit — and overrunning it fails in the worst
// possible way, with login succeeding and every subsequent request rejected.
// checkout-service needs only the id (authorisation) and the email
// (notification); display falls back to the email.
func trimChainForClaim(chain []storage.ApprovalStepConfig) []storage.ApprovalStepConfig {
	if len(chain) == 0 {
		return nil
	}
	out := make([]storage.ApprovalStepConfig, 0, len(chain))
	for _, step := range chain {
		approvers := make([]storage.Approver, 0, len(step.Approvers))
		for _, a := range step.Approvers {
			approvers = append(approvers, storage.Approver{AccountID: a.AccountID, Email: a.Email})
		}
		out = append(out, storage.ApprovalStepConfig{Name: step.Name, Approvers: approvers})
	}
	return out
}

// orgApprovalClaim builds the organisation's approval policy claim.
//
// Sourced from the organisation's own account, never from anything the other side
// of the trade wrote. It serves BOTH sides: a buying organisation gating its own
// spending, and a selling organisation requiring internal sign-off before a quote
// goes out. One policy per token rather than one per supplier relationship.
//
// Caller must have established the account is not RoleB2C — a storefront shopper
// is a person, not an organisation.
func orgApprovalClaim(gov *storage.OrgGovernance) *auth.OrgApproval {
	if gov == nil || gov.Approval == nil {
		return nil
	}
	p := gov.Approval
	claim := &auth.OrgApproval{Scope: p.Scope, Chain: trimChainForClaim(p.Chain)}
	if p.Threshold > 0 {
		v := p.Threshold
		claim.Threshold = &v
	}
	if p.QuantityThreshold > 0 {
		v := p.QuantityThreshold
		claim.QuantityThreshold = &v
	}
	if p.ValidityHours > 0 {
		v := p.ValidityHours
		claim.ValidityHours = &v
	}
	return claim
}

func extractClaim(userClaim map[string]interface{}) (role, userID string, err error) {
	role, _ = userClaim["role"].(string)
	userID, _ = userClaim["id"].(string)
	if role == "" || userID == "" {
		return "", "", fmt.Errorf("invalid token claims")
	}
	return role, userID, nil
}

// --- Route Handlers ---

func (h *LambdaHandler) handleAccounts(userClaim map[string]interface{}, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// New logic to handle /accounts/{id}/regenerate
	pathParts := strings.Split(strings.Trim(request.Path, "/"), "/")
	if len(pathParts) == 3 && pathParts[0] == "accounts" && pathParts[2] == "regenerate" {
		if request.HTTPMethod == "POST" {
			id := pathParts[1]
			authHeader := request.Headers["Authorization"]
			jwtToken := ""
			if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
				jwtToken = strings.TrimPrefix(authHeader, "Bearer ")
			}
			return h.regenerateStorefront(userClaim, id, jwtToken)
		}
	}
	if request.Path == "/accounts/export" && request.HTTPMethod == "GET" {
		return h.exportCustomers(userClaim)
	}
	if request.Path == "/accounts" && request.HTTPMethod == "GET" {
		return h.getAccounts(userClaim, request)
	}
	if id, ok := request.PathParameters["id"]; ok {
		switch request.HTTPMethod {
		case "GET":
			return h.getAccountByID(userClaim, id)
		case "PATCH", "PUT":
			authHeader := request.Headers["Authorization"]
			jwtToken := ""
			if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
				jwtToken = strings.TrimPrefix(authHeader, "Bearer ")
			}
			return h.updateAccount(userClaim, id, request.Body, jwtToken)
		case "DELETE":
			return h.deleteAccount(userClaim, id)
		}
	}
	return h.errorResponse(http.StatusMethodNotAllowed, "Method not allowed"), nil
}

func (h *LambdaHandler) handleLocations(userClaim map[string]interface{}, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	parts := strings.Split(strings.Trim(request.Path, "/"), "/") // accounts/locations/{accountID}/{locationID}

	if len(parts) == 3 { // /accounts/locations/{accountID}
		accountID := parts[2]
		switch request.HTTPMethod {
		case "GET":
			return h.getLocations(userClaim, accountID)
		case "POST":
			return h.upsertLocation(userClaim, accountID, request.Body)
		}
	}
	if len(parts) == 4 { // /accounts/locations/{accountID}/{locationID}
		accountID := parts[2]
		locationID := parts[3]
		if request.HTTPMethod == "DELETE" {
			return h.deleteLocation(userClaim, accountID, locationID)
		}
	}
	return h.errorResponse(http.StatusMethodNotAllowed, "Method not allowed"), nil
}

func (h *LambdaHandler) handleCodes(userClaim map[string]interface{}, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if request.Path == "/codes" {
		switch request.HTTPMethod {
		case "GET":
			return h.getCodes(userClaim)
		case "POST":
			return h.createCode(userClaim, request.Body)
		}
	}
	if code, ok := request.PathParameters["code"]; ok {
		switch request.HTTPMethod {
		case "GET":
			return h.getCode(userClaim, code)
		case "DELETE":
			return h.deleteCode(userClaim, code)
		}
	}
	return h.errorResponse(http.StatusMethodNotAllowed, "Method not allowed"), nil
}

func (h *LambdaHandler) handleCustomers(userClaim map[string]interface{}, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	parts := strings.Split(strings.Trim(request.Path, "/"), "/") // customers/{customerId}/[configuration|associate]
	if len(parts) != 3 {
		return h.errorResponse(http.StatusNotFound, "Not found"), nil
	}
	customerID := parts[1]
	action := parts[2]

	if request.HTTPMethod == "PATCH" {
		if action == "configuration" {
			return h.updateCustomerConfiguration(userClaim, customerID, request.Body)
		}
		if action == "associate" {
			return h.associateCustomerWithCompany(userClaim, customerID, request.Body)
		}
	}
	return h.errorResponse(http.StatusMethodNotAllowed, "Method not allowed"), nil
}

// --- Handler Implementations ---

// NOTE: Implementations are based on original http.go, converted to Lambda format.

// --- Public Handlers ---

// randomPassword returns an unguessable password for guest (passwordless) b2c
// accounts. Never shown or returned; the account is claimed later via reset.
func randomPassword() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return primitive.NewObjectID().Hex() + primitive.NewObjectID().Hex()
	}
	return fmt.Sprintf("%x", b)
}

func (h *LambdaHandler) register(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var req storage.RegisterRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}

	// Check for duplicate email
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		return h.errorResponse(http.StatusBadRequest, "Email is required"), nil
	}
	if _, err := h.db.GetAccountByEmail(email); err == nil {
		return h.errorResponse(http.StatusConflict, "An account with this email already exists"), nil
	}

	// Guest checkout: a b2c account with no password submitted. Skip strength
	// validation and seal it with a crypto-random password (never returned) so it
	// can only be claimed later via the existing password-reset flow. All other
	// registrations are unchanged.
	// An invite code disqualifies the guest path. isGuest is decided here, but the
	// org-invite branch further down overwrites acc.Role with the root's role, so a
	// request carrying role "b2c", no password and a company invite code used to
	// skip password validation, get sealed with a random password, and then be
	// stored as a COMPANY colleague nobody could ever log into. Requiring the code
	// to be absent keeps guest checkout exactly as it was (the storefront never
	// sends one) while forcing an invited colleague down the normal validation path.
	isGuest := req.Role == storage.RoleB2C && strings.TrimSpace(req.Password) == "" &&
		strings.TrimSpace(req.OrgInviteCode) == ""
	if !isGuest {
		if err := validatePassword(req.Password); err != nil {
			return h.errorResponse(http.StatusBadRequest, err.Error()), nil
		}
	}
	pw := req.Password
	if isGuest {
		pw = randomPassword()
	}
	hashedPassword, err := auth.HashPassword(pw)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to hash password"), nil
	}

	acc := &storage.Account{
		ID:            primitive.NewObjectID(),
		Name:          strings.TrimSpace(req.Name),
		Email:         email,
		PhoneNumber:   strings.TrimSpace(req.PhoneNumber),
		Password:      hashedPassword,
		Role:          req.Role,
		AccountStatus: storage.AccountActive,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	// Logic for roles from original handler
	// Joining an existing organisation short-circuits the role/code switch below:
	// a colleague inherits the organisation's platform role and its data, so they
	// need no code of their own. Handled before the switch so an invite code can
	// never be combined with a company/customer code to claim something extra.
	if strings.TrimSpace(req.OrgInviteCode) != "" {
		root, rErr := h.db.GetAccountByOrgInviteCode(strings.TrimSpace(req.OrgInviteCode))
		if rErr != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid organisation invite code"), nil
		}
		// Only a root hands out invites; a member cannot spawn a sub-organisation,
		// which keeps the hierarchy one level deep and OrgID a single lookup.
		if !root.IsOrgRoot() {
			return h.errorResponse(http.StatusBadRequest, "That invite code does not belong to an organisation"), nil
		}
		// A storefront shopper is a person, not an organisation, and must never
		// gain a colleague's view of B2B data.
		if root.Role == storage.RoleB2C {
			return h.errorResponse(http.StatusBadRequest, "Storefront accounts do not have an organisation"), nil
		}
		acc.Role = root.Role
		acc.ParentAccountID = root.ID.Hex()
		acc.OrgRole = storage.OrgRoleUser
		// Customers reach their suppliers through customerConfigs, so a colleague
		// inherits the same attachments; otherwise they would join the
		// organisation but see none of the companies it buys from.
		if root.Role == storage.RoleCustomer && root.CustomerData != nil {
			acc.CustomerData = &storage.CustomerData{CustomerConfigs: root.CustomerData.CustomerConfigs}
		}
		if err := h.db.CreateAccount(acc); err != nil {
			log.Printf("Failed to create member account: %v", err)
			return h.errorResponse(http.StatusInternalServerError, "failed to create account"), nil
		}
		return h.successResponse(map[string]string{
			"message":   "Joined organisation",
			"accountId": acc.ID.Hex(),
			"orgId":     root.ID.Hex(),
		}, http.StatusCreated), nil
	}

	switch req.Role {
	case "admin":
		// No specific data needed
	case "company":
		if req.Code == "" {
			return h.errorResponse(http.StatusBadRequest, "companyCode required"), nil
		}
		codeDoc, err := h.db.GetCode(bson.M{"companyCode": req.Code, "is_claimed": false})
		if err != nil {
			return h.errorResponse(http.StatusBadRequest, "invalid or already-claimed company code"), nil
		}
		acc.ID = codeDoc.ID
		acc.CompanyData = &storage.CompanyData{
			CompanyCodeID: codeDoc.ID.Hex(),
			CompanyCode:   codeDoc.CompanyCode,
			Status:        "pending_setup",
		}
		_ = h.db.UpdateCode(codeDoc.ID, bson.M{"is_claimed": true})

	case "customer":
		if len(req.CustomerCodes) == 0 {
			return h.errorResponse(http.StatusBadRequest, "at least one customerCode required"), nil
		}
		var entries []storage.CustomerCodeEntry
		for _, cc := range req.CustomerCodes {
			codeDoc, err := h.db.GetCode(bson.M{"customerCode": cc})
			if err != nil {
				return h.errorResponse(http.StatusBadRequest, "invalid customer code"), nil
			}
			entries = append(entries, storage.CustomerCodeEntry{
				CodeID: codeDoc.ID.Hex(),
				Code:   codeDoc.CustomerCode,
			})
		}
		acc.CustomerData = &storage.CustomerData{CustomerConfigs: entries}

	case "partner":
		if req.Code == "" {
			return h.errorResponse(http.StatusBadRequest, "partner invite code required"), nil
		}
		codeDoc, err := h.db.GetCode(bson.M{"partnerCode": req.Code})
		if err != nil {
			return h.errorResponse(http.StatusBadRequest, "invalid partner invite code"), nil
		}
		acc.PartnerData = &storage.PartnerData{
			Status:    "active",
			CompanyID: codeDoc.ID.Hex(),
		}
	case storage.RoleB2C:
		if req.Code == "" {
			return h.errorResponse(http.StatusBadRequest, "companyCode required for b2c registration"), nil
		}
		codeDoc, err := h.db.GetCode(bson.M{"companyCode": req.Code})
		if err != nil {
			return h.errorResponse(http.StatusBadRequest, "invalid company code for b2c registration"), nil
		}
		acc.CustomerData = &storage.CustomerData{
			CustomerConfigs: []storage.CustomerCodeEntry{
				{
					CodeID: codeDoc.ID.Hex(),
					Code:   codeDoc.CustomerCode,
				},
			},
		}

	default:
		return h.errorResponse(http.StatusBadRequest, "invalid role"), nil
	}

	if err := h.db.CreateAccount(acc); err != nil {
		log.Printf("Failed to create account: %v", err)
		return h.errorResponse(http.StatusInternalServerError, "failed to create account"), nil
	}

	// Non-blocking welcome email — failure is logged but never blocks registration.
	// Customer-facing email uses the company's own SMTP (so the customer sees their
	// storefront brand, not BusinessCart). Falls back to platform sender for company /
	// partner registrations and when the company hasn't configured per-company SMTP.
	//
	// Guests get no welcome or "new customer" email here: they didn't sign up, they
	// bought. The order flow sends their order confirmation (customer) and new-order
	// email (company). These fire only for a real registration.
	if h.emailSender != nil && !isGuest {
		sellerID := ""
		if acc.CustomerData != nil && len(acc.CustomerData.CustomerConfigs) > 0 {
			sellerID = acc.CustomerData.CustomerConfigs[0].CodeID
		}
		sender, _ := mailer.SenderForCompany(context.Background(), sellerID, h.emailSender)
		brandName, brandEmail := mailer.CompanyBrand(sellerID)
		go func(name, addr, bn, be string, s mailer.Sender) {
			if err := s.Send(context.Background(), mailer.WelcomeMessage(name, addr, bn, be)); err != nil {
				log.Printf("WARN: welcome email failed for %s: %v", addr, err)
			}
		}(acc.Name, acc.Email, brandName, brandEmail, sender)

		// Notify the company owner about the new customer (platform sender, BC SES).
		if sellerID != "" {
			if ownerEmail := mailer.CompanyOwnerEmail(sellerID); ownerEmail != "" {
				go func(to, customerName string) {
					if err := h.emailSender.Send(context.Background(), mailer.NewCustomerToCompanyMessage(to, customerName)); err != nil {
						log.Printf("WARN: new-customer notification failed for owner %s: %v", to, err)
					}
				}(ownerEmail, acc.Name)
			}
		}
	}

	// Guest register mints a token in the same call so the storefront needs no
	// separate login round-trip (one-step guest checkout).
	if isGuest {
		accessToken, refreshToken, terr := h.issueCustomerToken(acc)
		if terr != nil {
			return h.errorResponse(http.StatusInternalServerError, "Token generation failed"), nil
		}
		return h.successResponse(map[string]interface{}{
			"account":      acc,
			"accessToken":  accessToken,
			"refreshToken": refreshToken,
		}, http.StatusCreated), nil
	}

	return h.successResponse(acc, http.StatusCreated), nil
}

func (h *LambdaHandler) login(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var creds storage.LoginRequest
	if err := json.Unmarshal([]byte(request.Body), &creds); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid body"), nil
	}

	creds.Email = strings.TrimSpace(strings.ToLower(creds.Email))
	user, err := h.db.GetAccountByEmail(creds.Email)
	if err != nil || !auth.CheckPasswordHash(creds.Password, user.Password) {
		return h.errorResponse(http.StatusUnauthorized, "Invalid credentials"), nil
	}

	// Stamp the login. Best-effort: a write failure must never cost the user
	// their session, so the error is logged and dropped. Only lastLogin is sent,
	// so updatedAt stays untouched (see the field comment on Account).
	if uerr := h.db.UpdateAccount(user.ID, map[string]interface{}{"lastLogin": time.Now()}); uerr != nil {
		log.Printf("ERROR: lastLogin update for %s: %v", user.ID.Hex(), uerr)
	}

	accessToken, refreshToken, err := h.issueCustomerToken(user)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Token generation failed"), nil
	}

	response := map[string]string{
		"accessToken":  accessToken,
		"refreshToken": refreshToken,
	}

	return h.successResponse(response, http.StatusOK), nil
}

// issueCustomerToken builds the access + refresh JWTs for a user, embedding the
// customer/b2c config claims (company defaults + overrides + groups) and the
// partner assoc. Extracted verbatim from login so guest register can mint an
// identical token in one call; behavior-preserving for login.
func (h *LambdaHandler) issueCustomerToken(user *storage.Account) (string, string, error) {
	var assocIDs []string
	var configs []auth.CustomerConfiguration
	// The approval policy belongs to the ORGANISATION, so a colleague who joined
	// resolves the root's rather than their own — theirs is nil. Without this a
	// buying organisation could configure approvals, invite colleagues, and have
	// none of their orders gated: the control would silently miss exactly the
	// people it exists for. Read once per login, and only for an account that
	// actually has a parent.
	orgGovernance := user.Governance
	// A colleague's own account holds neither the organisation's policy nor its
	// trading terms, so both are read from the root. One lookup, once per login.
	customerData := user.CustomerData
	if user.ParentAccountID != "" {
		if rootOID, oErr := primitive.ObjectIDFromHex(user.ParentAccountID); oErr == nil {
			if root, rErr := h.db.GetAccountByID(rootOID); rErr == nil {
				orgGovernance = root.Governance
				// The SUPPLIER RELATIONSHIPS too, not just the policy. Joining
				// copied the root's customerConfigs once, at registration, and the
				// copy then froze: a seller raising this buyer's credit limit or
				// moving them to another price group reached the root at their next
				// login and never reached anyone who had already joined. Two people
				// in the same buying organisation checked out on different terms.
				// Reading them live also fixes the PATCH join path, which copies
				// nothing at all and so left a colleague attached to no suppliers.
				if root.Role == storage.RoleCustomer && root.CustomerData != nil {
					customerData = root.CustomerData
				}
			} else {
				// Fail closed on the safe side: no policy means no gate, but say so
				// loudly rather than let a silent miss look like "not configured".
				log.Printf("ERROR: could not load organisation root %s for account %s; approval policy and supplier terms will NOT be applied: %v",
					user.ParentAccountID, user.ID.Hex(), rErr)
			}
		}
	}

	if (user.Role == storage.RoleCustomer || user.Role == storage.RoleB2C) && customerData != nil {
		for _, e := range customerData.CustomerConfigs {
			assocIDs = append(assocIDs, e.CodeID)
		}

		// Fetch associated company data to resolve enforcement defaults
		companyMap := make(map[string]*storage.CompanyData)
		if len(assocIDs) > 0 {
			companyIDs := make([]primitive.ObjectID, 0, len(assocIDs))
			for _, id := range assocIDs {
				if oid, err := primitive.ObjectIDFromHex(id); err == nil {
					companyIDs = append(companyIDs, oid)
				}
			}
			if companies, err := h.db.GetAccountCompaniesDataByIDs(companyIDs); err != nil {
				log.Printf("Warning: Failed to fetch company data for JWT enforcement: %v", err)
				// This is the exact site that 500'd uSetGo's admin GET /accounts on
				// 2026-05-05 (company.shippingRate stored as ""). Alert so the next
				// data-shape regression is caught in minutes, not customer complaints.
				mailer.NotifyAdmin(h.emailSender, "Failed to fetch company data", err.Error())
			} else {
				for _, c := range companies {
					if c.CompanyData != nil {
						companyMap[c.ID.Hex()] = c.CompanyData
					}
				}
			}
		}

		for _, e := range customerData.CustomerConfigs {
			config := auth.CustomerConfiguration{CompanyID: e.CodeID}

			// Existing 5 fields: customer override only (backward compatible)
			if e.Configuration != nil {
				config.DiscountPercentage = e.Configuration.DiscountPercentage
				config.PaymentMethods = e.Configuration.PaymentMethods
				config.DeliveryMethods = e.Configuration.DeliveryMethods
				config.ShippingOutOptions = e.Configuration.ShippingOutOptions
				config.QuotesAllowed = e.Configuration.QuotesAllowed
			}

			// New 8 float fields: resolved (company default + customer override)
			// TaxableGoods excluded — CompanyData uses plain bool, can't distinguish
			// "never set" (false) from "explicitly disabled" (false). Checkout defaults
			// to taxable when absent. Customer override still carried if set.
			company := companyMap[e.CodeID]
			if company != nil {
				config.CreditLimit = resolveFloat(company.CreditLimit, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.CreditLimit }))
				config.MinOrderAmountLimit = resolveFloat(company.MinOrderAmountLimit, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.MinOrderAmountLimit }))
				config.MaxOrderAmountLimit = resolveFloat(company.MaxOrderAmountLimit, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.MaxOrderAmountLimit }))
				config.MinOrderQuantityLimit = resolveFloat(company.MinOrderQuantityLimit, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.MinOrderQuantityLimit }))
				config.MaxOrderQuantityLimit = resolveFloat(company.MaxOrderQuantityLimit, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.MaxOrderQuantityLimit }))
				config.MonthlyOrderLimit = resolveFloat(company.MonthlyOrderLimit, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.MonthlyOrderLimit }))
				config.YearlyOrderLimit = resolveFloat(company.YearlyOrderLimit, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.YearlyOrderLimit }))
				config.LeadTime = resolveFloat(company.LeadTime, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.LeadTime }))
				config.TaxRate = resolveFloat(company.TaxRate, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.TaxRate }))
				config.ShippingRate = resolveFloat(company.ShippingRate, override(e.Configuration, func(c *storage.CustomerConfiguration) *float64 { return c.ShippingRate }))

				// Resolve customer's group → embed groupID + groupPriceDiscount.
				// Stale/missing group ID → silently no embed (falls back to base pricing).
				if e.GroupID != "" {
					for _, g := range company.CustomerGroups {
						if g.ID == e.GroupID {
							config.GroupID = e.GroupID
							if g.GroupPriceDiscount > 0 {
								d := g.GroupPriceDiscount
								config.GroupPriceDiscount = &d
							}
							break
						}
					}
				}
			}
			// TaxableGoods: customer override only (same as existing 5 fields)
			if e.Configuration != nil {
				config.TaxableGoods = e.Configuration.TaxableGoods
				config.CouponsEnabled = e.Configuration.CouponsEnabled
			}

			configs = append(configs, config)
		}
	}

	// Partner role: carry the linked company id in assocIDs so catalog/checkout
	// can use the existing associate_company_ids claim path without a new field.
	if user.Role == storage.RolePartner && user.PartnerData != nil && user.PartnerData.CompanyID != "" {
		assocIDs = append(assocIDs, user.PartnerData.CompanyID)
	}

	// OrgID resolves to the account's own id until a parent is assigned, so this
	// is inert for every account that exists today.
	// One org-level policy per token, for a buying OR selling organisation. b2c is
	// excluded: a storefront shopper is a person, not an organisation, and
	// withholding the claim is the first of the two guards that keep D2C ungated.
	var orgApproval *auth.OrgApproval
	if user.Role == storage.RoleCustomer || user.Role == storage.RoleCompany {
		orgApproval = orgApprovalClaim(orgGovernance)
	}

	// Seniority inside the organisation. Emitted for the two org-capable roles
	// only: a platform admin belongs to no organisation, and a storefront shopper
	// is a person rather than one.
	orgRole := ""
	if user.Role == storage.RoleCustomer || user.Role == storage.RoleCompany {
		orgRole = user.EffectiveOrgRole()
	}

	accessToken, err := auth.GenerateJWT(user.ID.Hex(), user.OrgID(), orgRole, user.Email, user.Role, h.jwtSecret, assocIDs, configs, orgApproval)
	if err != nil {
		return "", "", err
	}
	refreshToken, _ := auth.GenerateRefreshToken(user.ID.Hex(), user.OrgID(), user.Email, user.Role, h.jwtRefreshSecret, assocIDs)
	return accessToken, refreshToken, nil
}

func (h *LambdaHandler) refreshToken(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// This is a simplified version. A real implementation would require stateful refresh token validation.
	return h.errorResponse(http.StatusNotImplemented, "Refresh token functionality is not fully implemented in this version."), nil
}

func (h *LambdaHandler) logoutUser(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// In a stateless Lambda architecture, logout is primarily a client-side operation (deleting the token).
	// A stateful implementation would involve a token blacklist.
	return h.successResponse(map[string]string{"message": "Logged out"}, http.StatusOK), nil
}

func (h *LambdaHandler) forgotPassword(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var req struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		return h.errorResponse(http.StatusBadRequest, "Email is required"), nil
	}

	// Always return success to prevent email enumeration
	successMsg := map[string]string{"message": "If an account with that email exists, a reset link has been sent."}

	acc, err := h.db.GetAccountByEmail(req.Email)
	if err != nil {
		return h.successResponse(successMsg, http.StatusOK), nil
	}

	// Generate 32-byte random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Printf("WARN: failed to generate reset token: %v", err)
		return h.successResponse(successMsg, http.StatusOK), nil
	}
	token := hex.EncodeToString(tokenBytes)
	expiry := time.Now().Add(1 * time.Hour)

	// Store token + expiry on account
	if err := h.db.UpdateAccount(acc.ID, map[string]interface{}{
		"resetToken":       token,
		"resetTokenExpiry": expiry,
	}); err != nil {
		log.Printf("WARN: failed to save reset token for %s: %v", req.Email, err)
		return h.successResponse(successMsg, http.StatusOK), nil
	}

	// Determine reset URL based on request origin
	origin := h.requestOrigin
	if origin == "" {
		origin = "https://businesscart.ai"
	}
	resetURL := fmt.Sprintf("%s/reset-password?token=%s", origin, token)

	// Non-blocking email — failure is logged but never blocks response.
	// Customer/b2c reset comes from the company's own SMTP (storefront brand);
	// company-role reset stays on the platform sender (admin context).
	if h.emailSender != nil {
		sellerID := ""
		if acc.CustomerData != nil && len(acc.CustomerData.CustomerConfigs) > 0 {
			sellerID = acc.CustomerData.CustomerConfigs[0].CodeID
		}
		sender, _ := mailer.SenderForCompany(context.Background(), sellerID, h.emailSender)
		brandName, brandEmail := mailer.CompanyBrand(sellerID)
		go func(name, addr, url, bn, be string, s mailer.Sender) {
			if err := s.Send(context.Background(), mailer.PasswordResetMessage(name, addr, url, bn, be)); err != nil {
				log.Printf("WARN: password reset email failed for %s: %v", addr, err)
			}
		}(acc.Name, acc.Email, resetURL, brandName, brandEmail, sender)
	}

	return h.successResponse(successMsg, http.StatusOK), nil
}

func (h *LambdaHandler) resetPassword(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}
	if req.Token == "" || req.Password == "" {
		return h.errorResponse(http.StatusBadRequest, "Token and password are required"), nil
	}

	// Validate password strength (same rules as registration)
	if len(req.Password) < 8 {
		return h.errorResponse(http.StatusBadRequest, "Password must be at least 8 characters"), nil
	}
	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, c := range req.Password {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasDigit = true
		case unicode.IsPunct(c) || unicode.IsSymbol(c):
			hasSpecial = true
		}
	}
	if !hasUpper || !hasLower || !hasDigit || !hasSpecial {
		return h.errorResponse(http.StatusBadRequest, "Password must contain uppercase, lowercase, digit, and special character"), nil
	}

	// Find account by reset token
	acc, err := h.db.GetAccountByResetToken(req.Token)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid or expired reset token"), nil
	}

	// Check expiry
	if acc.ResetTokenExpiry == nil || acc.ResetTokenExpiry.Before(time.Now()) {
		return h.errorResponse(http.StatusBadRequest, "Invalid or expired reset token"), nil
	}

	// Hash new password
	hashed, err := auth.HashPassword(req.Password)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to process password"), nil
	}

	// Update password and clear reset token
	if err := h.db.UpdateAccount(acc.ID,
		map[string]interface{}{"password": hashed},
		map[string]interface{}{"resetToken": "", "resetTokenExpiry": ""},
	); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to update password"), nil
	}

	return h.successResponse(map[string]string{"message": "Password has been reset successfully."}, http.StatusOK), nil
}

// --- Protected Handlers ---

func (h *LambdaHandler) getAccounts(userClaim map[string]interface{}, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	role, userID, err := extractClaim(userClaim)
	if err != nil {
		return h.errorResponse(http.StatusUnauthorized, "Invalid token claims"), nil
	}

	var filter bson.M
	switch role {
	case storage.RoleAdmin:
		filter = bson.M{}
	case storage.RoleCompany:
		// Customers are attached to the ORGANISATION's id, so a second account in
		// the same selling organisation must resolve the same customer list rather
		// than an empty one.
		orgID := orgIDFromClaim(userClaim)
		orgIDHex, _ := primitive.ObjectIDFromHex(orgID)
		userIDHex, _ := primitive.ObjectIDFromHex(userID)
		filter = bson.M{
			"$or": []bson.M{
				{"_id": userIDHex},
				{"_id": orgIDHex},
				{"customer.customerConfigs.codeId": orgID},
				// Colleagues in the same organisation, so the Staff panel can list
				// them and the root can remove one.
				{"parentAccountId": orgID},
			},
		}
	case storage.RoleCustomer, storage.RoleB2C, storage.RolePartner:
		userIDHex, _ := primitive.ObjectIDFromHex(userID)
		// Themselves, plus anyone in their organisation. Deliberately NOT every
		// customer of their supplier: that list stays private, which is why
		// approvers are named by email rather than picked from a directory.
		filter = bson.M{"$or": []bson.M{
			{"_id": userIDHex},
			{"parentAccountId": orgIDFromClaim(userClaim)},
		}}
	default:
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized"), nil
	}

	accounts, err := h.db.GetAccounts(filter)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to retrieve accounts"), nil
	}

	if len(accounts) == 0 {
		return h.successResponse([]*storage.Account{}, http.StatusOK), nil
	}

	// An account's OWN internal structure is not the list reader's to see. This is
	// the one endpoint that returns somebody else's document, and it returns the
	// whole thing unprojected, so two things leaked:
	//
	//   - a seller's list contains every attached CUSTOMER, so it handed the
	//     supplier each buyer's governance.approval chain, approver emails and
	//     names included. That is exactly the data Quote.RedactedFor strips from
	//     the quote payload, and exactly what the FAQ and Compare page promise a
	//     supplier cannot see.
	//   - every colleague's list contains the organisation ROOT, so a staff-level
	//     account could read orgInviteCode and hand it to an outsider, walking
	//     straight past "only the organisation owner can manage its people".
	//
	// Redacted rather than dropped from the JSON entirely, because the owner's own
	// account page legitimately renders both fields.
	if role != storage.RoleAdmin {
		for i := range accounts {
			if accounts[i] != nil && accounts[i].ID.Hex() != userID {
				accounts[i].Governance = nil
				accounts[i].OrgInviteCode = ""
			}
		}
	}

	return h.successResponse(accounts, http.StatusOK), nil
}

func (h *LambdaHandler) exportCustomers(userClaim map[string]interface{}) (events.APIGatewayProxyResponse, error) {
	role, _, err := extractClaim(userClaim)
	if err != nil {
		return h.errorResponse(http.StatusUnauthorized, "Invalid token claims"), nil
	}
	if role != storage.RoleCompany && role != storage.RoleAdmin {
		return h.errorResponse(http.StatusForbidden, "Only company or admin can export"), nil
	}

	var filter bson.M
	if role == storage.RoleAdmin {
		filter = bson.M{"role": bson.M{"$in": []string{"customer", "b2c"}}}
	} else {
		filter = bson.M{"customer.customerConfigs.codeId": orgIDFromClaim(userClaim)}
	}

	accounts, err := h.db.GetAccounts(filter)
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to retrieve accounts"), nil
	}

	var b strings.Builder
	b.WriteString("Name,Email,Role,Created\n")
	for _, a := range accounts {
		created := ""
		if !a.CreatedAt.IsZero() {
			created = a.CreatedAt.Format("2006-01-02")
		}
		name := strings.ReplaceAll(a.Name, ",", " ")
		email := strings.ReplaceAll(a.Email, ",", " ")
		b.WriteString(fmt.Sprintf("%s,%s,%s,%s\n", name, email, a.Role, created))
	}

	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers: map[string]string{
			"Content-Type":                "text/csv",
			"Content-Disposition":         "attachment; filename=customers.csv",
			"Access-Control-Allow-Origin": h.requestOrigin,
		},
		Body: b.String(),
	}, nil
}

// buildAdConversionSetFields encrypts each supplied ad-conversion credential and
// returns the Mongo $set entries keyed by a dotted per-field path
// (adConversions.<provider>.<field>). Using per-field paths means a partial
// update (e.g. rotating the access_token while leaving the pixel_id field blank)
// merges into the existing sub-document instead of replacing it and dropping the
// field the client did not resend — a whole-map $set on adConversions.<provider>
// would wipe it. Blank values are trimmed and skipped.
func (h *LambdaHandler) buildAdConversionSetFields(payload map[string]map[string]string) (map[string]interface{}, error) {
	out := make(map[string]interface{})
	for provider, creds := range payload {
		if !conversion.IsSupportedProvider(provider) {
			continue // ignore unknown providers rather than persisting junk keys
		}
		for field, val := range creds {
			val = strings.TrimSpace(val)
			if val == "" {
				continue
			}
			ct, err := conversion.Encrypt(h.convKey, val)
			if err != nil {
				return nil, err
			}
			out["adConversions."+provider+"."+field] = ct
		}
	}
	return out, nil
}

// buildAdConversionsInfo decrypts an account's stored ad-conversion creds in
// memory and populates the display-safe AdConversionsInfo (pixel_id shown
// fully — it is not secret; access_token masked to last-4). The raw token is
// never exposed. Mirrors the payment gateway's last-4 hint.
func (h *LambdaHandler) buildAdConversionsInfo(acc *storage.Account) {
	if acc == nil || len(acc.AdConversions) == 0 || len(h.convKey) == 0 {
		return
	}
	info := make(map[string]storage.AdConversionInfo, len(acc.AdConversions))
	for provider, creds := range acc.AdConversions {
		ci := storage.AdConversionInfo{Configured: true, Enabled: acc.AdConversionsEnabled[provider]}
		// dec decrypts a stored field in memory; "" on absence/failure.
		dec := func(field string) string {
			if enc, ok := creds[field]; ok {
				if v, derr := conversion.Decrypt(h.convKey, enc); derr == nil {
					return v
				}
			}
			return ""
		}
		last4 := func(s string) string {
			if len(s) >= 4 {
				return s[len(s)-4:]
			}
			return ""
		}
		switch provider {
		case conversion.ProviderMeta:
			ci.PixelID = dec("pixel_id")
			ci.TokenLast4 = last4(dec("access_token"))
		case conversion.ProviderGoogle:
			// Non-secret account/config IDs shown in full; refresh_token hinted.
			ci.CustomerID = dec("customer_id")
			ci.ConversionActionID = dec("conversion_action_id")
			ci.ViewContentActionID = dec("conversion_action_id_viewcontent")
			ci.AddToCartActionID = dec("conversion_action_id_addtocart")
			ci.CheckoutActionID = dec("conversion_action_id_initiatecheckout")
			ci.TokenLast4 = last4(dec("refresh_token"))
		}
		info[provider] = ci
	}
	acc.AdConversionsInfo = info
}

func (h *LambdaHandler) getAccountByID(userClaim map[string]interface{}, id string) (events.APIGatewayProxyResponse, error) {
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid ID"), nil
	}

	// Authorization: An admin can get any account. Other roles can only get their own.
	if userClaim["role"] != storage.RoleAdmin && userClaim["id"] != id {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}

	acc, err := h.db.GetAccountByID(objID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "Account not found"), nil
	}

	// Attach the masked, secret-free conversion-credential status for the admin UI.
	h.buildAdConversionsInfo(acc)

	// If the account is a customer, attach the full company data they are associated with.
	if acc.Role == storage.RoleCustomer || acc.Role == storage.RoleB2C {
		if acc.CustomerData == nil {
			acc.CustomerData = &storage.CustomerData{}
		}

		// Fetch and attach customer addresses
		addresses, err := h.db.GetCustomerAddresses(bson.M{"customerId": acc.ID})
		if err != nil {
			log.Printf("Failed to get addresses for customer %s: %v", acc.ID.Hex(), err)
			acc.CustomerData.CustomerAddresses = []storage.CustomerAddress{}
		} else {
			plainAddresses := make([]storage.CustomerAddress, len(addresses))
			for i, addrPtr := range addresses {
				if addrPtr != nil {
					plainAddresses[i] = *addrPtr
				}
			}
			acc.CustomerData.CustomerAddresses = plainAddresses
		}

		// Use the associate_company_ids from the JWT for authorization
		if assocCompanyIDs, ok := userClaim["associate_company_ids"].([]interface{}); ok && len(assocCompanyIDs) > 0 {
			var ids []primitive.ObjectID
			for _, idInterface := range assocCompanyIDs {
				if idStr, ok := idInterface.(string); ok {
					if oid, err := primitive.ObjectIDFromHex(idStr); err == nil {
						ids = append(ids, oid)
					}
				}
			}

			if len(ids) > 0 {
				companies, _ := h.db.GetAccountCompaniesDataByIDs(ids)
				attached := make([]storage.AttachedCompaniesData, 0, len(companies))
				for _, c := range companies {
					if c.CompanyData != nil {
						// For each company, fetch its locations
						locations, err := h.db.GetCompanyLocations(bson.M{"companyId": c.ID})
						if err != nil {
							log.Printf("Failed to get locations for company %s: %v", c.ID.Hex(), err)
							locations = []*storage.CompanyLocation{}
						}

						plainLocations := make([]storage.CompanyLocation, len(locations))
						for i, locPtr := range locations {
							if locPtr != nil {
								plainLocations[i] = *locPtr
							}
						}

						attached = append(attached, storage.AttachedCompaniesData{
							Name:                  c.CompanyData.Name,
							LogoURL:               c.CompanyData.LogoURL,
							CompanyCodeID:         c.CompanyData.CompanyCodeID,
							CompanyCode:           c.CompanyData.CompanyCode,
							SaleRepresentative:    c.CompanyData.SaleRepresentative,
							Address:               c.CompanyData.Address,
							CreditLimit:           c.CompanyData.CreditLimit,
							LeadTime:              c.CompanyData.LeadTime,
							MinOrderAmountLimit:   c.CompanyData.MinOrderAmountLimit,
							MaxOrderAmountLimit:   c.CompanyData.MaxOrderAmountLimit,
							MinOrderQuantityLimit: c.CompanyData.MinOrderQuantityLimit,
							MaxOrderQuantityLimit: c.CompanyData.MaxOrderQuantityLimit,
							MonthlyOrderLimit:     c.CompanyData.MonthlyOrderLimit,
							YearlyOrderLimit:      c.CompanyData.YearlyOrderLimit,
							TaxableGoods:          c.CompanyData.TaxableGoods,
							TaxRate:               c.CompanyData.TaxRate,
							ShippingRate:          c.CompanyData.ShippingRate,
							QuotesAllowed:         c.CompanyData.QuotesAllowed,
							CouponsEnabled:        c.CompanyData.CouponsEnabled,
							Status:                c.CompanyData.Status,
							ShippingOutOptions:    c.CompanyData.ShippingOutOptions,
							PaymentMethods:        c.CompanyData.PaymentMethods,
							DeliveryMethods:       c.CompanyData.DeliveryMethods,
							CompanyLocations:      plainLocations,
						})
					}
				}
				acc.CustomerData.AttachedCompanies = attached
			}
		}
	}

	// Surface the partner invite code on company reads. The Code row's _id equals
	// the company account _id (acc.ID = codeDoc.ID at company registration), so
	// this is a single primary-key lookup. Transient field, never persisted.
	if acc.Role == storage.RoleCompany && acc.CompanyData != nil {
		if codeDoc, err := h.db.GetCode(bson.M{"_id": acc.ID}); err == nil && codeDoc != nil {
			acc.CompanyData.PartnerCode = codeDoc.PartnerCode
		}
	}

	return h.successResponse(acc, http.StatusOK), nil
}

func (h *LambdaHandler) updateAccount(userClaim map[string]interface{}, id string, body string, jwtToken string) (events.APIGatewayProxyResponse, error) {
	// Implementation adapted from original UpdateAccount
	targetID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid ID"), nil
	}

	// Authorization
	role, userID, err := extractClaim(userClaim)
	if err != nil {
		return h.errorResponse(http.StatusUnauthorized, "Invalid token claims"), nil
	}
	if role != storage.RoleAdmin && userID != targetID.Hex() {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}

	var payload struct {
		Company              map[string]interface{}       `json:"company"`
		AdConversions        map[string]map[string]string `json:"adConversions"`
		AdConversionsEnabled map[string]bool              `json:"adConversionsEnabled"`
		// The account's OWN internal structure (Roadmap #21 approvals today;
		// buyer roles, hierarchy and cost centres later). It rides this endpoint
		// rather than a new one precisely because the authorisation above is
		// already the rule an organisation's self-governance needs: only that
		// account, or an admin acting for it, may write here. A seller therefore
		// cannot reach into their buyer's internal process, which is what went
		// wrong when this lived on the seller-written customer configuration.
		Governance *struct {
			Approval *storage.ApprovalPolicy `json:"approval"`
		} `json:"governance"`
		// Organisation membership controls (Roadmap #21c Phase 2). Same reasoning
		// as governance: this endpoint already restricts writes to the account
		// itself (or an admin), which is exactly who should hand out invites and
		// remove colleagues.
		Org *struct {
			RegenerateInviteCode bool   `json:"regenerateInviteCode"`
			RevokeInviteCode     bool   `json:"revokeInviteCode"`
			RemoveAccountID      string `json:"removeAccountId"`
			// An account that already exists joining an organisation. Registration
			// only covers people who are new; someone who already has a login
			// could otherwise never become a colleague.
			JoinWithInviteCode string `json:"joinWithInviteCode"`
			// Promote or demote a colleague (Roadmap #35g). Rides this payload
			// rather than a new route for the same reason the rest of it does: the
			// authorisation here is already exactly right, self-or-admin, and the
			// root-only gate below is exactly who should be handing out seniority.
			SetRoleAccountID string `json:"setRoleAccountId"`
			SetRole          string `json:"setRole"`
		} `json:"org"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid body"), nil
	}

	// API-first contract: reject type mismatches at the boundary so the DB
	// never holds invalid state. Specifically guards against the frontend
	// sending "" for a cleared <input type=number>, which Go's BSON decoder
	// later rejects with "cannot decode string into a float64" → 500 on every
	// admin GET /accounts. See validateCompanyFieldTypes for the full rule.
	if err := validateCompanyFieldTypes(payload.Company); err != nil {
		return h.errorResponse(http.StatusBadRequest, err.Error()), nil
	}

	// Sanitize string fields that affect URLs and display
	for k, v := range payload.Company {
		if str, ok := v.(string); ok {
			if k == "name" || k == "contactEmail" || k == "contactPhone" {
				payload.Company[k] = strings.TrimSpace(str)
			}
		}
	}

	// Validate customerGroups (max MaxCustomerGroups, valid fields)
	if rawGroups, ok := payload.Company["customerGroups"]; ok && rawGroups != nil {
		groups, ok := rawGroups.([]interface{})
		if !ok {
			return h.errorResponse(http.StatusBadRequest, "customerGroups must be an array"), nil
		}
		if len(groups) > MaxCustomerGroups {
			return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("Maximum %d customer groups allowed per company", MaxCustomerGroups)), nil
		}
		seenIDs := make(map[string]bool)
		for i, g := range groups {
			gMap, ok := g.(map[string]interface{})
			if !ok {
				return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("customerGroups[%d] is not an object", i)), nil
			}
			id, _ := gMap["id"].(string)
			name, _ := gMap["name"].(string)
			id = strings.TrimSpace(id)
			name = strings.TrimSpace(name)
			if id == "" {
				return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("customerGroups[%d] missing id", i)), nil
			}
			if name == "" {
				return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("customerGroups[%d] missing name", i)), nil
			}
			if seenIDs[id] {
				return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("customerGroups: duplicate id %q", id)), nil
			}
			seenIDs[id] = true
			if discount, ok := gMap["groupPriceDiscount"].(float64); ok {
				if discount < 0 || discount > 100 {
					return h.errorResponse(http.StatusBadRequest, fmt.Sprintf("customerGroups[%d] groupPriceDiscount must be 0-100", i)), nil
				}
			}
			gMap["id"] = id
			gMap["name"] = name
		}
	}

	setFields := bson.M{}
	unsetFields := bson.M{}
	for k, v := range payload.Company {
		// Only admin can change company codes
		if (k == "companyCode" || k == "companyCodeId") && role != storage.RoleAdmin {
			continue
		}

		// Only admin can toggle D2C enabled or change custom domain
		if k == "d2c" {
			if d2c, ok := v.(map[string]interface{}); ok {
				if role != storage.RoleAdmin {
					// Prevent changing these fields by removing them from the update payload
					delete(d2c, "enabled")
					delete(d2c, "customDomain")
					delete(d2c, "previewDomain")
				}
				// Sanitize D2C string fields
				for subK, subV := range d2c {
					if str, ok := subV.(string); ok {
						if subK == "contactEmail" || subK == "contactPhone" || subK == "heroTitle" || subK == "heroSlogan" || subK == "customDomain" {
							d2c[subK] = strings.TrimSpace(str)
						}
					}
				}
				// Flatten the d2c map into individual set operations to avoid overwriting the whole object
				for subK, subV := range d2c {
					setFields["company.d2c."+subK] = subV
				}
				continue
			}
		}

		// Storage rule: empty array → unset (don't store empty arrays)
		if k == "customerGroups" {
			if arr, ok := v.([]interface{}); ok && len(arr) == 0 {
				unsetFields["company.customerGroups"] = ""
				continue
			}
		}

		setFields["company."+k] = v
	}

	// Ad-platform conversion credentials (Meta pixel_id + access_token; Google
	// later). Encrypt each value server-side before storing so the raw token
	// never lands in the DB. Rides this existing endpoint (no new route) and is
	// never returned (Account.AdConversions is json:"-"). Mirrors the payment
	// gateway credential-handling contract.
	if len(payload.AdConversions) > 0 {
		if len(h.convKey) == 0 {
			return h.errorResponse(http.StatusServiceUnavailable, "Ad-conversion tracking is not configured on this environment"), nil
		}
		encFields, encErr := h.buildAdConversionSetFields(payload.AdConversions)
		if encErr != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to secure credentials"), nil
		}
		for k, v := range encFields {
			setFields[k] = v
		}
	}
	// Per-provider enable/disable switch (not a secret; stored plainly).
	for provider, enabled := range payload.AdConversionsEnabled {
		if !conversion.IsSupportedProvider(provider) {
			continue
		}
		setFields["adConversionsEnabled."+provider] = enabled
	}

	// Own internal governance. The authorisation at the top of this handler is
	// what makes this safe: only this account (or an admin) reaches here.
	if payload.Governance != nil {
		// Checked against the TARGET account's role, not the caller's, so an admin
		// acting for a customer still works.
		//
		// Trading accounts only. A buying organisation gates its own spending; a
		// selling organisation requires internal sign-off before a quote goes out
		// (Roadmap #21d). Both are organisations with people in them.
		//
		// This was customer-only until #21c: a selling company used to be a SINGLE
		// account whose _id is the sellerId on every product, quote, order and
		// statement, so there was no second person at the seller to name and the
		// policy would have been a control that looks armed and never fires.
		// Organisation membership supplied the missing people.
		//
		// b2c stays out. A storefront shopper is a person, not an organisation.
		target, tErr := h.db.GetAccountByID(targetID)
		if tErr != nil {
			return h.errorResponse(http.StatusNotFound, "Account not found"), nil
		}
		if target.Role != storage.RoleCustomer && target.Role != storage.RoleCompany {
			return h.errorResponse(http.StatusForbidden,
				"An internal approval structure is available to buying and selling accounts only."), nil
		}
		// The policy belongs to the ORGANISATION and is read from its root, so a
		// colleague writing one on their own account would store something nothing
		// ever reads — a control that looks configured and never fires.
		if !target.IsOrgRoot() {
			return h.errorResponse(http.StatusForbidden,
				"Your organisation's approval structure is set by its owner."), nil
		}
		// Approvers are named by EMAIL and resolved here. The account id is never
		// taken from the client: there is no way for the caller to enumerate other
		// accounts (a customer's GET /accounts returns only themselves, by design,
		// so the seller's customer list stays private), and resolving server-side
		// means a policy can only ever name a real account that the person setting
		// it already knows how to reach.
		// SHAPE first, so an oversized chain is rejected before resolveApprovers
		// issues one DB lookup per named approver. Then resolve, then the full
		// check, which verifies what resolution produced.
		if err := validateApprovalPolicyBounds(payload.Governance.Approval); err != nil {
			return h.errorResponse(http.StatusBadRequest, err.Error()), nil
		}
		if err := h.resolveApprovers(payload.Governance.Approval, target, string(target.Role)); err != nil {
			return h.errorResponse(http.StatusBadRequest, err.Error()), nil
		}
		if err := validateApprovalPolicy(payload.Governance.Approval); err != nil {
			return h.errorResponse(http.StatusBadRequest, err.Error()), nil
		}
		// A seller only ever has a decision point on a NEGOTIABLE quote. Self-serve
		// checkout is created and paid by the buyer with no seller step in between,
		// so a "standard" scope on a selling account would store a control that
		// looks armed and can never fire.
		if target.Role == storage.RoleCompany && payload.Governance.Approval != nil {
			switch payload.Governance.Approval.Scope {
			case storage.ApprovalScopeStandard, storage.ApprovalScopeBoth:
				return h.errorResponse(http.StatusBadRequest,
					"A selling organisation can only require approval on quotes: a self-serve order has no seller step to hold."), nil
			}
		}
		// Store nothing empty: a cleared policy unsets the key rather than
		// leaving a hollow object, so an account that governs nothing carries
		// no field at all.
		if payload.Governance.Approval == nil || isEmptyApprovalPolicy(payload.Governance.Approval) {
			unsetFields["governance.approval"] = ""
		} else {
			setFields["governance.approval"] = payload.Governance.Approval
		}
	}

	// Organisation membership. Only a root hands out invites: its id is the OrgID
	// that every seller-scoped record is keyed by, so letting a member invite
	// would create a second level whose data ownership is undefined.
	if payload.Org != nil {
		target, tErr := h.db.GetAccountByID(targetID)
		if tErr != nil {
			return h.errorResponse(http.StatusNotFound, "Account not found"), nil
		}
		if target.Role == storage.RoleB2C {
			return h.errorResponse(http.StatusForbidden, "Storefront accounts do not have an organisation"), nil
		}
		// Joining is the one org action an account takes on ITSELF rather than on
		// people below it, so it is handled before the root-only gate.
		if code := strings.TrimSpace(payload.Org.JoinWithInviteCode); code != "" {
			// Joining clears this account's own invite code while regenerate would
			// set it; naming one path in both $set and $unset makes MongoDB reject
			// the entire update. They are also contradictory in intent — you are
			// either becoming part of an organisation or running your own.
			if payload.Org.RegenerateInviteCode || payload.Org.RevokeInviteCode {
				return h.errorResponse(http.StatusBadRequest,
					"Joining an organisation cannot be combined with changing your own invite code"), nil
			}
			if !target.IsOrgRoot() {
				return h.errorResponse(http.StatusBadRequest, "You already belong to an organisation"), nil
			}
			// Someone who has people of their own would drag them into a second
			// level. Keeping the hierarchy one deep is what lets OrgID stay a
			// single field read rather than a tree walk.
			members, mErr := h.db.GetAccounts(bson.M{"parentAccountId": targetID.Hex()})
			if mErr == nil && len(members) > 0 {
				return h.errorResponse(http.StatusBadRequest,
					"Your organisation already has people in it, so it cannot join another"), nil
			}
			root, rErr := h.db.GetAccountByOrgInviteCode(code)
			if rErr != nil {
				return h.errorResponse(http.StatusBadRequest, "Invalid organisation invite code"), nil
			}
			if !root.IsOrgRoot() {
				return h.errorResponse(http.StatusBadRequest, "That invite code does not belong to an organisation"), nil
			}
			if root.ID.Hex() == targetID.Hex() {
				return h.errorResponse(http.StatusBadRequest, "You cannot join your own organisation"), nil
			}
			// A colleague shares the organisation's view of its data, so the
			// platform role has to match — a customer must not land inside a
			// selling company and inherit its catalogue and orders.
			if root.Role != target.Role {
				return h.errorResponse(http.StatusBadRequest,
					"That invite code belongs to a different kind of account"), nil
			}
			setFields["parentAccountId"] = root.ID.Hex()
			setFields["orgRole"] = storage.OrgRoleUser
			// Their own invite code would be meaningless once they are not a root.
			unsetFields["orgInviteCode"] = ""
		}

		if !target.IsOrgRoot() {
			return h.errorResponse(http.StatusForbidden, "Only the organisation owner can manage its people"), nil
		}
		if payload.Org.RegenerateInviteCode && payload.Org.RevokeInviteCode {
			// Naming one path in both $set and $unset makes MongoDB reject the
			// entire update, so this 500s and takes any company or governance
			// fields in the same payload down with it. The join branch above
			// already guards this hazard; this pair had no equivalent.
			return h.errorResponse(http.StatusBadRequest,
				"Choose either a new invite code or revoking the current one, not both."), nil
		}
		if payload.Org.RegenerateInviteCode {
			code, cErr := newOrgInviteCode()
			if cErr != nil {
				return h.errorResponse(http.StatusInternalServerError, "Could not generate an invite code"), nil
			}
			setFields["orgInviteCode"] = code
		}
		if payload.Org.RevokeInviteCode {
			// Rotating or revoking never touches existing members: their link is
			// ParentAccountID, not the code they happened to arrive with.
			unsetFields["orgInviteCode"] = ""
		}
		if id := strings.TrimSpace(payload.Org.SetRoleAccountID); id != "" {
			want := strings.TrimSpace(payload.Org.SetRole)
			// Owner is not assignable. It means "root of this organisation", which
			// is a structural fact rather than a setting, so granting it would put
			// the account in a state EffectiveOrgRole cannot produce.
			if want != storage.OrgRoleAdmin && want != storage.OrgRoleUser {
				return h.errorResponse(http.StatusBadRequest,
					"A colleague can be set to admin or user."), nil
			}
			memberOID, mErr := primitive.ObjectIDFromHex(id)
			if mErr != nil {
				return h.errorResponse(http.StatusBadRequest, "Invalid account id"), nil
			}
			member, memErr := h.db.GetAccountByID(memberOID)
			if memErr != nil {
				return h.errorResponse(http.StatusNotFound, "That person is not in your organisation"), nil
			}
			// Scoped to THIS organisation. Without it a root could rewrite the
			// seniority of anyone whose id they happened to guess.
			if member.ParentAccountID != targetID.Hex() {
				return h.errorResponse(http.StatusForbidden, "That person is not in your organisation"), nil
			}
			if uErr := h.db.UpdateAccount(memberOID, bson.M{"orgRole": want}, bson.M{}); uErr != nil {
				return h.errorResponse(http.StatusInternalServerError, "Could not change their role"), nil
			}
		}

		if id := strings.TrimSpace(payload.Org.RemoveAccountID); id != "" {
			memberOID, mErr := primitive.ObjectIDFromHex(id)
			if mErr != nil {
				return h.errorResponse(http.StatusBadRequest, "Invalid account ID"), nil
			}
			person, mErr := h.db.GetAccountByID(memberOID)
			if mErr != nil || person.ParentAccountID != targetID.Hex() {
				return h.errorResponse(http.StatusBadRequest, "That account does not belong to your organisation"), nil
			}
			// Unlink rather than delete. The person may own quotes, orders and
			// decisions that must stay attributable, so removing them from the
			// organisation must not erase the account behind that history.
			if err := h.db.UpdateAccount(memberOID, nil, map[string]interface{}{"parentAccountId": "", "orgRole": ""}); err != nil {
				return h.errorResponse(http.StatusInternalServerError, "Could not remove them from your organisation"), nil
			}
		}
	}

	if len(setFields) == 0 && len(unsetFields) == 0 {
		// Some org actions write to a COLLEAGUE's document rather than this one, so
		// the request is complete even with nothing to set here. Listed once, as a
		// predicate: this guard has now rejected a perfectly good request twice, by
		// running after a block that had already written and reporting 400 for a
		// change that actually applied. Anything added to the org payload that
		// targets another account belongs in here.
		writesToAColleague := payload.Org != nil &&
			(strings.TrimSpace(payload.Org.RemoveAccountID) != "" ||
				strings.TrimSpace(payload.Org.SetRoleAccountID) != "")
		if writesToAColleague {
			acc, gErr := h.db.GetAccountByID(targetID)
			if gErr != nil {
				return h.errorResponse(http.StatusInternalServerError, "Removed, but could not reload the account"), nil
			}
			return h.successResponse(acc, http.StatusOK), nil
		}
		return h.errorResponse(http.StatusBadRequest, "Nothing to update"), nil
	}

	if err := h.db.UpdateAccount(targetID, setFields, unsetFields); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Update failed"), nil
	}

	// A conversion-config change invalidates this seller's cached creds so the
	// change takes effect on this container immediately (others refresh by TTL).
	if h.convCache != nil && (len(payload.AdConversions) > 0 || len(payload.AdConversionsEnabled) > 0) {
		h.convCache.Invalidate(targetID.Hex())
	}

	// Trigger D2C generation if enabled (this will also generate PreviewDomain if
	// missing).
	//
	// `company` is the ONLY field on this endpoint the generator reads, so
	// anything else cannot change the storefront and must not pay for a full
	// regen + S3 upload + CloudFront invalidation, nor risk its misleading 500.
	// This started as a conversion-only exemption and had to be generalised:
	// `governance` and `org` (Roadmap #21/#21c/#21d) ride this same endpoint, so
	// every approval-policy save and every invite-code click on a company account
	// was regenerating the whole storefront — and once a catalog-fetch failure
	// became fatal, "Save approval structure" could return 500 with the write
	// already committed. Any company/D2C edit still regenerates as before.
	affectsStorefront := len(payload.Company) > 0
	if affectsStorefront {
		if err := h.triggerD2CGeneration(targetID); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Storefront generation failed: "+err.Error()), nil
		}
	}

	// Return the updated account to the frontend so it sees the generated PreviewDomain
	updatedAcc, err := h.db.GetAccountByID(targetID)
	if err != nil {
		return h.successResponse(nil, http.StatusOK), nil
	}
	h.buildAdConversionsInfo(updatedAcc)

	return h.successResponse(updatedAcc, http.StatusOK), nil
}

func (h *LambdaHandler) regenerateStorefront(userClaim map[string]interface{}, id string, jwtToken string) (events.APIGatewayProxyResponse, error) {
	targetID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid ID"), nil
	}

	// Authorization - Admin or the company itself
	role, userID, err := extractClaim(userClaim)
	if err != nil {
		return h.errorResponse(http.StatusUnauthorized, "Invalid token claims"), nil
	}
	if role != storage.RoleAdmin && userID != targetID.Hex() {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}

	// Trigger generation synchronously
	if err := h.triggerD2CGeneration(targetID); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Storefront generation failed: "+err.Error()), nil
	}

	return h.successResponse(map[string]string{"message": "Storefront generation has completed."}, http.StatusOK), nil
}

// triggerD2CGeneration regenerates one company's storefront. It deliberately takes no
// caller token: generation must always read the target company's own catalog, so the
// scope is derived from accountID and never from whoever triggered the request.
func (h *LambdaHandler) triggerD2CGeneration(accountID primitive.ObjectID) error {
	acc, err := h.db.GetAccountByID(accountID)
	if err != nil || acc.CompanyData == nil || acc.CompanyData.D2C == nil {
		log.Printf("D2C Generation Skip: account or D2C config not found for %s", accountID.Hex())
		return nil
	}

	// 1. Initialize Generator and S3 Client (needed for both Enable and Disable)
	cfg, err := config.LoadDefaultConfig(context.TODO())
	var s3Client *s3.Client
	var cfClient *cloudfront.Client
	if err == nil {
		s3Client = s3.NewFromConfig(cfg)
		cfClient = cloudfront.NewFromConfig(cfg)
	} else {
		log.Printf("Warning: Failed to load AWS config: %v", err)
	}

	tmplDir := os.Getenv("D2C_TEMPLATE_DIR")
	outputDir := os.Getenv("D2C_OUTPUT_DIR")
	if outputDir == "" {
		outputDir = "/tmp/storefronts"
	}

	gen := generator.NewGenerator(tmplDir, outputDir, s3Client, h.d2cBucketName, cfClient, h.d2cDistributionId)

	// 2. Handle Case: Storefront Disabled (Offboarding)
	if !acc.CompanyData.D2C.Enabled {
		log.Printf("D2C Storefront disabled for %s. Cleaning up S3 assets...", acc.CompanyData.Name)
		if err := gen.DeleteStorefront(acc.CompanyData.UniqueIdentifier); err != nil {
			log.Printf("ERROR: Failed to delete storefront assets for %s: %v", acc.ID.Hex(), err)
		}
		return nil
	}

	log.Printf("D2C Storefront generating for %s...", acc.CompanyData.Name)

	// 3. Ensure PreviewDomain is set (Source of truth)
	if acc.CompanyData.D2C.PreviewDomain == "" {
		prefix := acc.CompanyData.UniqueIdentifier
		if prefix == "" {
			prefix = acc.ID.Hex()
		}
		acc.CompanyData.D2C.PreviewDomain = prefix + ".businesscart.ai"
		_ = h.db.UpdateAccount(acc.ID, bson.M{"company.d2c.previewDomain": acc.CompanyData.D2C.PreviewDomain})
	}

	// 4. Fetch Products (only active products for storefront).
	//
	// Deliberately the LEAST privileged org role. The generator never reads
	// Product.Cost, and confidential cost must never reach a public storefront
	// (Roadmap #40), so the machine token that builds one is given no way to see
	// it. Nothing in generation needs more.
	//
	// The catalog is read with a token scoped to THIS company, never the caller's.
	// catalog-service derives tenancy from the JWT, so an admin token resolves to
	// every seller (role "admin" => filter {}) and published other tenants' catalogs
	// onto this company's public storefront whenever an admin regenerated it.
	companyID := acc.ID.Hex()
	scopedToken, err := auth.GenerateJWT(companyID, acc.OrgID(), storage.OrgRoleUser, acc.Email, storage.RoleCompany, h.jwtSecret, nil, nil, nil)
	if err != nil {
		log.Printf("D2C Generation Failed for %s: could not mint scoped token: %v", companyID, err)
		return fmt.Errorf("scoped token for storefront generation: %w", err)
	}

	// A failed catalog read aborts generation. Publishing the empty slice would wipe the
	// live storefront's listings and push an empty Shopping feed, removing every product
	// from Merchant Center. A company that genuinely has no products still generates:
	// that is a successful fetch returning none, not an error.
	allProducts, err := h.fetchCompanyProducts(companyID, scopedToken)
	if err != nil {
		log.Printf("D2C Generation Failed for %s: catalog fetch: %v", companyID, err)
		return fmt.Errorf("catalog fetch for storefront generation: %w", err)
	}
	products := ownedProducts(allProducts, companyID)

	// 4b. Fetch Blog Posts (isolated — silent fail; never blocks storefront)
	allBlogPosts := h.fetchCompanyBlogPosts(companyID, scopedToken)
	blogPosts := ownedBlogPosts(allBlogPosts, companyID)

	// 5. Run Generator
	genData := generator.StorefrontData{
		AccountID: acc.ID.Hex(),
		Company:   acc.CompanyData,
		Config:    acc.CompanyData.D2C,
		Products:  products,
		BlogPosts: blogPosts,
		ApiBase:   os.Getenv("API_BASE_URL"),
	}

	if err := gen.Generate(genData); err != nil {
		log.Printf("D2C Generation Failed for %s: %v", acc.ID.Hex(), err)
		return err
	}

	// Invalidate CloudFront cache for this company only
	if err := gen.InvalidateCache(acc.CompanyData.UniqueIdentifier); err != nil {
		log.Printf("CloudFront invalidation warning for %s: %v", acc.CompanyData.Name, err)
		// Don't return error — generation succeeded, invalidation is best-effort
	}

	log.Printf("D2C Storefront successfully generated for %s at https://%s", acc.CompanyData.Name, acc.CompanyData.D2C.PreviewDomain)
	return nil
}

// ownedProducts keeps only companyID's active products. A generated storefront is a
// public, single-tenant artifact, so a foreign sellerID reaching it would publish
// another company's catalog (names, prices, SKUs, stock) on this company's domain.
// Scope is already enforced by the company-scoped token in triggerD2CGeneration; this
// is the publication boundary that still holds if any fetch ever returns foreign rows.
// Returns a nil slice when nothing matches, matching the previous inline filter.
func ownedProducts(all []generator.ProductData, companyID string) []generator.ProductData {
	var out []generator.ProductData
	for _, p := range all {
		if p.SellerID != companyID {
			log.Printf("SECURITY: dropped product %s (sellerID=%q) from storefront of %s", p.ID, p.SellerID, companyID)
			continue
		}
		if p.Active == nil || *p.Active {
			out = append(out, p)
		}
	}
	return out
}

// ownedBlogPosts mirrors ownedProducts for editorial content.
func ownedBlogPosts(all []generator.BlogPostData, companyID string) []generator.BlogPostData {
	var out []generator.BlogPostData
	for _, p := range all {
		if p.SellerID != companyID {
			log.Printf("SECURITY: dropped blog post %s (sellerID=%q) from storefront of %s", p.ID, p.SellerID, companyID)
			continue
		}
		if p.Active == nil || *p.Active {
			out = append(out, p)
		}
	}
	return out
}

// fetchCompanyProducts returns the company's catalog, or an error if the catalog could
// not be read. A failed fetch MUST NOT be reported as an empty catalog: the caller would
// republish the live storefront and the Shopping feed with zero products, which empties
// the site and pulls every listing out of Merchant Center. "No products" is only ever a
// successful response that happened to contain none.
func (h *LambdaHandler) fetchCompanyProducts(companyID string, jwtToken string) ([]generator.ProductData, error) {
	log.Printf("Fetching products for companyID: %s using provided JWT", companyID)

	catalogServiceURL := os.Getenv("CATALOG_SERVICE_URL")
	if catalogServiceURL == "" {
		return nil, fmt.Errorf("CATALOG_SERVICE_URL not set")
	}

	productsURL := fmt.Sprintf("%s/products", catalogServiceURL)
	log.Printf("DEBUG: Catalog Service URL: %s", catalogServiceURL)
	log.Printf("DEBUG: Products Endpoint URL: %s", productsURL)
	log.Printf("DEBUG: JWT Token Length: %d", len(jwtToken))

	req, err := http.NewRequest("GET", productsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build catalog request: %w", err)
	}

	req.Header.Add("Authorization", "Bearer "+jwtToken)
	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call catalog-service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("catalog-service returned %d: %s", resp.StatusCode, string(bodyBytes))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read catalog response: %w", err)
	}

	var products []generator.ProductData
	if err := json.Unmarshal(bodyBytes, &products); err != nil {
		return nil, fmt.Errorf("decode catalog response: %w", err)
	}

	log.Printf("Successfully fetched %d products for companyID %s from catalog-service", len(products), companyID)

	// Calculate DiscountedPrice if DealPrice exists (DealPrice is a percentage 0-50)
	for i := range products {
		if products[i].DealPrice > 0 {
			products[i].DiscountedPrice = products[i].Price * (1 - products[i].DealPrice/100)
		}
	}

	return products, nil
}

// fetchCompanyBlogPosts is the isolated blog fetch — mirrors fetchCompanyProducts.
// Silent-fail returns empty slice on any error so a catalog-service outage or
// pre-blog-deploy state never blocks storefront regeneration.
func (h *LambdaHandler) fetchCompanyBlogPosts(companyID string, jwtToken string) []generator.BlogPostData {
	catalogServiceURL := os.Getenv("CATALOG_SERVICE_URL")
	if catalogServiceURL == "" {
		return []generator.BlogPostData{}
	}

	url := fmt.Sprintf("%s/blog", catalogServiceURL)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		log.Printf("[blog-fetch] new request error: %v", err)
		return []generator.BlogPostData{}
	}
	req.Header.Add("Authorization", "Bearer "+jwtToken)
	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[blog-fetch] request error for companyID %s: %v", companyID, err)
		return []generator.BlogPostData{}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Could be 404 if route not deployed yet — silent skip
		return []generator.BlogPostData{}
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return []generator.BlogPostData{}
	}

	var posts []generator.BlogPostData
	if err := json.Unmarshal(bodyBytes, &posts); err != nil {
		log.Printf("[blog-fetch] unmarshal error: %v", err)
		return []generator.BlogPostData{}
	}

	log.Printf("[blog-fetch] fetched %d posts for companyID %s", len(posts), companyID)
	return posts
}

func (h *LambdaHandler) deleteAccount(userClaim map[string]interface{}, id string) (events.APIGatewayProxyResponse, error) {
	// Authorization: simple admin check
	if userClaim["role"] != storage.RoleAdmin {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}
	objID, _ := primitive.ObjectIDFromHex(id)
	acc, _ := h.db.GetAccountByID(objID)
	_ = h.db.DeleteAccount(objID)
	if acc != nil && acc.Role == storage.RoleCompany {
		_ = h.db.DeleteCode(objID) // cascade: Code._id == company.account._id by design
	}
	return h.successResponse(nil, http.StatusNoContent), nil
}

func (h *LambdaHandler) createCode(userClaim map[string]interface{}, body string) (events.APIGatewayProxyResponse, error) {
	if userClaim["role"] != "admin" {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized"), nil
	}
	var req storage.CreateCodeRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid body"), nil
	}
	if req.CompanyCode == "" {
		return h.errorResponse(http.StatusBadRequest, "companyCode required"), nil
	}

	// Upsert by companyCode. If a row already exists, the request is an edit:
	// only partnerCode is mutable; companyCode and customerCode are locked
	// because companyCode is tied to the company account _id at registration.
	if existing, err := h.db.GetCode(bson.M{"companyCode": req.CompanyCode}); err == nil && existing != nil {
		if err := h.db.UpdateCode(existing.ID, bson.M{"partnerCode": req.PartnerCode}); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "failed to update code"), nil
		}
		doc, _ := h.db.GetCode(bson.M{"_id": existing.ID})
		return h.successResponse(doc, http.StatusOK), nil
	}

	// Create mode: existing behavior unchanged.
	codeDoc := &storage.Code{
		ID:           primitive.NewObjectID(),
		CompanyCode:  req.CompanyCode,
		CustomerCode: req.CustomerCode,
		PartnerCode:  req.PartnerCode,
		IsClaimed:    false,
		CreatedAt:    time.Now(),
	}
	if err := h.db.CreateCode(codeDoc); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "failed to create code"), nil
	}
	return h.successResponse(codeDoc, http.StatusCreated), nil
}

func (h *LambdaHandler) getCode(userClaim map[string]interface{}, code string) (events.APIGatewayProxyResponse, error) {
	if userClaim["role"] != "admin" {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized"), nil
	}
	doc, err := h.db.GetCode(bson.M{"$or": []bson.M{
		{"companyCode": code},
		{"customerCode": code},
		{"partnerCode": code},
	}})
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "code not found"), nil
	}
	return h.successResponse(doc, http.StatusOK), nil
}

func (h *LambdaHandler) deleteCode(userClaim map[string]interface{}, code string) (events.APIGatewayProxyResponse, error) {
	if userClaim["role"] != storage.RoleAdmin {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}
	doc, err := h.db.GetCode(bson.M{"$or": []bson.M{
		{"companyCode": code},
		{"customerCode": code},
		{"partnerCode": code},
	}})
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "code not found"), nil
	}
	if doc.IsClaimed {
		return h.errorResponse(http.StatusConflict, "code is claimed; delete the account first"), nil
	}
	if err := h.db.DeleteCode(doc.ID); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "failed to delete code"), nil
	}
	return h.successResponse(nil, http.StatusNoContent), nil
}

func (h *LambdaHandler) getCodes(userClaim map[string]interface{}) (events.APIGatewayProxyResponse, error) {
	if userClaim["role"] != "admin" {
		return h.errorResponse(http.StatusUnauthorized, "Unauthorized"), nil
	}
	codes, err := h.db.GetCodes(bson.M{})
	if err != nil {
		return h.errorResponse(http.StatusInternalServerError, "failed to retrieve codes"), nil
	}
	if len(codes) == 0 {
		return h.successResponse([]*storage.Code{}, http.StatusOK), nil
	}
	return h.successResponse(codes, http.StatusOK), nil
}

func (h *LambdaHandler) updateCustomerConfiguration(userClaim map[string]interface{}, customerIDStr string, body string) (events.APIGatewayProxyResponse, error) {
	if userClaim["role"] != storage.RoleCompany {
		return h.errorResponse(http.StatusForbidden, "Forbidden"), nil
	}
	customerID, err := primitive.ObjectIDFromHex(customerIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid customer ID"), nil
	}
	companyID, _ := userClaim["id"].(string)
	if companyID == "" {
		return h.errorResponse(http.StatusUnauthorized, "Invalid token claims"), nil
	}

	// Parse raw body to handle both config fields and groupID together
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}

	// Re-marshal/unmarshal into typed CustomerConfiguration so existing fields populate
	var config storage.CustomerConfiguration
	if cfgBytes, err := json.Marshal(raw); err == nil {
		_ = json.Unmarshal(cfgBytes, &config)
	}

	// Parse and validate groupID (if present in request)
	var groupIDPtr *string
	if rawGID, exists := raw["groupID"]; exists {
		gidStr, _ := rawGID.(string)
		gidStr = strings.TrimSpace(gidStr)
		if gidStr != "" {
			// Validate the group exists in this company
			companyOID, err := primitive.ObjectIDFromHex(companyID)
			if err != nil {
				return h.errorResponse(http.StatusBadRequest, "Invalid company ID in token"), nil
			}
			companyAcc, err := h.db.GetAccountByID(companyOID)
			if err != nil || companyAcc.CompanyData == nil {
				return h.errorResponse(http.StatusNotFound, "Company not found"), nil
			}
			found := false
			for _, g := range companyAcc.CompanyData.CustomerGroups {
				if g.ID == gidStr {
					found = true
					break
				}
			}
			if !found {
				return h.errorResponse(http.StatusBadRequest, "groupID does not exist in company's customer groups"), nil
			}
		}
		groupIDPtr = &gidStr
	}

	if err := h.db.UpdateCustomerConfiguration(customerID, companyID, &config, groupIDPtr); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to update configuration"), nil
	}
	return h.successResponse(nil, http.StatusOK), nil
}

func (h *LambdaHandler) associateCustomerWithCompany(userClaim map[string]interface{}, customerIDStr string, body string) (events.APIGatewayProxyResponse, error) {
	customerID, err := primitive.ObjectIDFromHex(customerIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid customer ID"), nil
	}

	role, actorID, err := extractClaim(userClaim)
	if err != nil {
		return h.errorResponse(http.StatusUnauthorized, "Invalid token claims"), nil
	}

	var entry *storage.CustomerCodeEntry

	switch role {
	case storage.RoleCustomer, storage.RoleB2C:
		if actorID != customerIDStr {
			return h.errorResponse(http.StatusForbidden, "Forbidden: Customers can only associate their own account"), nil
		}
		var req storage.AssociateCustomerRequest
		if err := json.Unmarshal([]byte(body), &req); err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
		}
		if req.CustomerCode == "" {
			return h.errorResponse(http.StatusBadRequest, "customerCode is required"), nil
		}
		codeDoc, err := h.db.GetCode(bson.M{"customerCode": req.CustomerCode})
		if err != nil {
			return h.errorResponse(http.StatusBadRequest, "Invalid customer code"), nil
		}
		entry = &storage.CustomerCodeEntry{CodeID: codeDoc.ID.Hex(), Code: codeDoc.CustomerCode}

	case storage.RoleCompany:
		companyID, _ := primitive.ObjectIDFromHex(actorID)
		companyAccount, err := h.db.GetAccountByID(companyID)
		if err != nil || companyAccount.CompanyData == nil {
			return h.errorResponse(http.StatusNotFound, "Could not find company data"), nil
		}
		codeDoc, err := h.db.GetCode(bson.M{"companyCode": companyAccount.CompanyData.CompanyCode})
		if err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Could not find associated customer code for company"), nil
		}
		entry = &storage.CustomerCodeEntry{CodeID: codeDoc.ID.Hex(), Code: codeDoc.CustomerCode}
	default:
		return h.errorResponse(http.StatusForbidden, "Forbidden: Invalid role for this action"), nil
	}

	if err := h.db.AddCustomerAssociation(customerID, entry); err != nil {
		return h.errorResponse(http.StatusInternalServerError, "Failed to update customer associations"), nil
	}
	return h.successResponse(nil, http.StatusOK), nil
}

func (h *LambdaHandler) getLocations(userClaim map[string]interface{}, accountIDStr string) (events.APIGatewayProxyResponse, error) {
	accountID, err := primitive.ObjectIDFromHex(accountIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid accountID"), nil
	}
	// NOTE: Simplified authorization. A real implementation would be more robust.
	// Allow admin or if the user is requesting their own locations.
	if userClaim["role"] != storage.RoleAdmin && userClaim["id"] != accountIDStr {
		return h.errorResponse(http.StatusForbidden, "Unauthorized"), nil
	}

	acc, err := h.db.GetAccountByID(accountID)
	if err != nil {
		return h.errorResponse(http.StatusNotFound, "account not found"), nil
	}

	if acc.Role == storage.RoleCompany {
		locations, err := h.db.GetCompanyLocations(bson.M{"companyId": accountID})
		if err != nil {
			return h.errorResponse(http.StatusInternalServerError, "failed to get company locations"), nil
		}
		return h.successResponse(locations, http.StatusOK), nil
	}
	if acc.Role == storage.RoleCustomer || acc.Role == storage.RoleB2C {
		addresses, err := h.db.GetCustomerAddresses(bson.M{"customerId": accountID})
		if err != nil {
			return h.errorResponse(http.StatusInternalServerError, "failed to get customer addresses"), nil
		}
		return h.successResponse(addresses, http.StatusOK), nil
	}
	return h.errorResponse(http.StatusBadRequest, "role not supported for locations"), nil
}

func (h *LambdaHandler) upsertLocation(userClaim map[string]interface{}, accountIDStr string, body string) (events.APIGatewayProxyResponse, error) {
	accountID, err := primitive.ObjectIDFromHex(accountIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid accountID"), nil
	}
	// Authorization
	if userClaim["id"] != accountIDStr {
		return h.errorResponse(http.StatusForbidden, "Unauthorized"), nil
	}

	acc, _ := h.db.GetAccountByID(accountID)
	switch acc.Role {
	case storage.RoleCompany:
		var loc storage.CompanyLocation
		if err := json.Unmarshal([]byte(body), &loc); err != nil {
			return h.errorResponse(http.StatusBadRequest, "invalid request body"), nil
		}
		loc.CompanyID = accountID
		// Simplified upsert logic from original
		loc.ID = primitive.NewObjectID()
		if err := h.db.CreateCompanyLocation(&loc); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "failed to create company location"), nil
		}
		return h.successResponse(loc, http.StatusCreated), nil

	case storage.RoleCustomer, storage.RoleB2C:
		var addr storage.CustomerAddress
		if err := json.Unmarshal([]byte(body), &addr); err != nil {
			return h.errorResponse(http.StatusBadRequest, "invalid request body"), nil
		}
		addr.CustomerID = accountID
		// Simplified upsert logic from original
		addr.ID = primitive.NewObjectID()
		if err := h.db.CreateCustomerAddress(&addr); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "failed to create customer address"), nil
		}
		return h.successResponse(addr, http.StatusCreated), nil
	}
	return h.errorResponse(http.StatusBadRequest, "role not supported for locations"), nil
}

func (h *LambdaHandler) deleteLocation(userClaim map[string]interface{}, accountIDStr string, locationIDStr string) (events.APIGatewayProxyResponse, error) {
	accountID, err := primitive.ObjectIDFromHex(accountIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid accountID"), nil
	}
	locationID, err := primitive.ObjectIDFromHex(locationIDStr)
	if err != nil {
		return h.errorResponse(http.StatusBadRequest, "invalid locationID"), nil
	}
	// Authorization
	if userClaim["id"] != accountIDStr && userClaim["role"] != storage.RoleAdmin {
		return h.errorResponse(http.StatusForbidden, "Unauthorized"), nil
	}

	acc, _ := h.db.GetAccountByID(accountID)
	switch acc.Role {
	case storage.RoleCompany:
		if err := h.db.DeleteCompanyLocation(locationID); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "failed to delete company location"), nil
		}
	case storage.RoleCustomer, storage.RoleB2C:
		if err := h.db.DeleteCustomerAddress(locationID); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "failed to delete customer address"), nil
		}
	default:
		return h.errorResponse(http.StatusBadRequest, "role not supported for locations"), nil
	}
	return h.successResponse(nil, http.StatusNoContent), nil
}

// --- Utility Functions ---

func (h *LambdaHandler) errorResponse(statusCode int, message string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]string{"message": message})
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       string(body),
	}
}

func (h *LambdaHandler) successResponse(data interface{}, statusCode int) events.APIGatewayProxyResponse {
	var body string
	if data != nil {
		jsonBody, err := json.Marshal(data)
		if err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to marshal response")
		}
		body = string(jsonBody)
	}

	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    corsHeaders(h.requestOrigin),
		Body:       body,
	}
}

// ---------- visitor analytics ----------

// metaFloat coerces a JSON-decoded number to float64; returns 0 for anything
// else. JSON numbers always decode as float64 into map[string]interface{}, so
// that is the only case to handle.
func metaFloat(v interface{}) float64 {
	if n, ok := v.(float64); ok {
		return n
	}
	return 0
}

// parseConversionContents maps a piped items array ([{id|productId, quantity,
// price}]) into conversion line items. Tolerant of missing/oddly-typed fields.
func parseConversionContents(v interface{}) []conversion.Content {
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]conversion.Content, 0, len(arr))
	for _, it := range arr {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		id, _ := m["id"].(string)
		if id == "" {
			id, _ = m["productId"].(string)
		}
		if id == "" {
			continue
		}
		qty := int(metaFloat(m["quantity"]))
		if qty <= 0 {
			qty = 1
		}
		out = append(out, conversion.Content{ProductID: id, Quantity: qty, ItemPrice: metaFloat(m["price"])})
	}
	return out
}

func (h *LambdaHandler) trackVisitorEvent(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var req struct {
		VisitorID    string                 `json:"visitorId"`
		Event        string                 `json:"event"`
		Page         string                 `json:"page"`
		Referrer     string                 `json:"referrer"`
		UTMSource    string                 `json:"utm_source"`
		UTMMedium    string                 `json:"utm_medium"`
		UTMCampaign  string                 `json:"utm_campaign"`
		UTMContent   string                 `json:"utm_content"`
		UTMTerm      string                 `json:"utm_term"`
		ClickIDs     map[string]string      `json:"clickIds"`
		Timezone     string                 `json:"timezone"`
		ScreenWidth  int                    `json:"screenWidth"`
		ScreenHeight int                    `json:"screenHeight"`
		Language     string                 `json:"language"`
		CustomerID   string                 `json:"customerId"`
		SellerID     string                 `json:"sellerId"`
		Metadata     map[string]interface{} `json:"metadata"`
	}

	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return h.errorResponse(http.StatusBadRequest, "Invalid request body"), nil
	}

	if req.VisitorID == "" || req.Event == "" {
		return h.errorResponse(http.StatusBadRequest, "visitorId and event are required"), nil
	}

	// Skip internal users (admin, company, partner). Capture the shopper's email
	// for conversion match quality while we already have the account loaded.
	var customerEmail string
	if req.CustomerID != "" {
		if oid, err := primitive.ObjectIDFromHex(req.CustomerID); err == nil {
			if acc, err := h.db.GetAccountByID(oid); err == nil {
				if acc.Role == storage.RoleAdmin || acc.Role == storage.RoleCompany || acc.Role == storage.RolePartner {
					return h.successResponse(map[string]string{"status": "skipped"}, http.StatusOK), nil
				}
				customerEmail = acc.Email
			}
		}
	}

	// Read CloudFront headers
	headers := request.Headers
	country := headers["CloudFront-Viewer-Country"]
	region := headers["CloudFront-Viewer-Country-Region"]
	city := headers["CloudFront-Viewer-City"]
	timezone := headers["CloudFront-Viewer-Time-Zone"]
	if timezone == "" {
		timezone = req.Timezone
	}
	ip := headers["X-Forwarded-For"]
	if i := strings.Index(ip, ","); i > 0 {
		ip = strings.TrimSpace(ip[:i])
	}
	asn := headers["CloudFront-Viewer-ASN"]
	userAgent := headers["User-Agent"]
	if userAgent == "" {
		userAgent = headers["user-agent"]
	}

	// Detect device from CloudFront headers
	device := "desktop"
	if headers["CloudFront-Is-Mobile-Viewer"] == "true" {
		device = "mobile"
	} else if headers["CloudFront-Is-Tablet-Viewer"] == "true" {
		device = "tablet"
	} else if headers["CloudFront-Is-SmartTV-Viewer"] == "true" {
		device = "smarttv"
	}

	// Parse browser and OS from User-Agent
	browser, os := parseUserAgent(userAgent)

	// Fix: iPhone/iPad requesting desktop site reports "Macintosh" in UA
	if device == "mobile" && os == "macOS" {
		os = "iOS"
	}

	// Detect bots
	isBot, botName := detectBot(userAgent, asn)

	source, medium := resolveSourceMedium(req.UTMSource, req.UTMMedium, req.Referrer)
	if isBot {
		medium = "bot"
	}

	// Build visitor object
	visitor := &storage.Visitor{
		VisitorID: req.VisitorID,
		SellerID:  req.SellerID,
		Attribution: storage.VisitorAttribution{
			Source:      source,
			Medium:      medium,
			Campaign:    req.UTMCampaign,
			Content:     req.UTMContent,
			Term:        req.UTMTerm,
			Referrer:    req.Referrer,
			LandingPage: req.Page,
			ClickIDs:    req.ClickIDs,
		},
		Geo: storage.VisitorGeo{
			Country:  country,
			Region:   region,
			City:     city,
			Timezone: timezone,
			IP:       ip,
			ASN:      asn,
		},
		Device:       device,
		OS:           os,
		Browser:      browser,
		IsBot:        isBot,
		BotName:      botName,
		ScreenWidth:  req.ScreenWidth,
		ScreenHeight: req.ScreenHeight,
		Language:     req.Language,
		Pages:        []string{req.Page},
		CustomerID:   req.CustomerID,
	}

	// Upsert visitor — if it fails, save a raw doc with error log
	if err := h.db.UpsertVisitor(visitor); err != nil {
		errMsg := fmt.Sprintf("%s: %v", time.Now().Format(time.RFC3339), err)
		log.Printf("ERROR: UpsertVisitor failed: %v", err)
		visitor.ErrorLog = []string{errMsg}
		// Try to at least save the raw data with error
		h.db.UpsertVisitor(visitor)
	}

	// Handle milestone events — errors are logged, never block the response
	now := time.Now()
	logErr := func(action string, err error) {
		if err != nil {
			errMsg := fmt.Sprintf("%s: %s: %v", now.Format(time.RFC3339), action, err)
			log.Printf("WARN: visitor event: %s", errMsg)
			h.db.AppendVisitorError(req.VisitorID, errMsg)
		}
	}

	// Server-side ad-platform conversions (Meta CAPI; Google later). Best-effort:
	// bounded, panic-safe, and never blocks the ingestion response. Credentials
	// live encrypted on the seller's company account (accounts.adConversions).
	// Results are attached to the milestone metadata below for the Analytics view.
	//
	// Skip bots: a crawler's ViewContent/etc. must not be sent to ad platforms
	// (pollutes optimization + inflates "conversions sent"). detectBot only flags
	// UAs carrying a bot token or datacenter-ASN traffic without "mozilla", so a
	// real browser (always "Mozilla/...") is never gated — no real conversion is
	// dropped. Bots are still recorded in analytics above; only the send is skipped.
	if h.conversions != nil && !isBot {
		var evName string
		switch req.Event {
		case "order":
			evName = "Purchase"
		case "initiate_checkout":
			evName = "InitiateCheckout"
		case "add_to_cart":
			evName = "AddToCart"
		case "view_content":
			evName = "ViewContent"
		}
		if evName != "" && req.SellerID != "" {
			// Enabled+configured creds, served from the warm-container cache;
			// the DB is hit only on a miss/expiry (see convCache TTL).
			enabledCreds := h.convCache.Get(req.SellerID, func() map[string]map[string]string {
				out := map[string]map[string]string{}
				sellerOID, err := primitive.ObjectIDFromHex(req.SellerID)
				if err != nil {
					return out
				}
				sellerAcc, aerr := h.db.GetAccountByID(sellerOID)
				if aerr != nil {
					return out
				}
				for provider, creds := range sellerAcc.AdConversions {
					if sellerAcc.AdConversionsEnabled[provider] {
						out[provider] = creds
					}
				}
				return out
			})
			if len(enabledCreds) > 0 {
				ev := conversion.Event{
					EventName:  evName,
					SellerID:   req.SellerID,
					EventTime:  now,
					Currency:   "USD",
					Country:    "us",
					Email:      customerEmail,
					ExternalID: req.VisitorID,
					ClientIP:   ip,
					ClientUA:   userAgent,
					Fbclid:     req.ClickIDs["fbclid"],
					Gclid:      req.ClickIDs["gclid"],
					Gbraid:     req.ClickIDs["gbraid"],
					Wbraid:     req.ClickIDs["wbraid"],
				}
				switch req.Event {
				case "order":
					if v, ok := req.Metadata["orderId"].(string); ok {
						ev.EventID = v
					}
					ev.Value = metaFloat(req.Metadata["amount"])
					ev.Contents = parseConversionContents(req.Metadata["items"])
				case "initiate_checkout":
					ev.Value = metaFloat(req.Metadata["amount"])
					ev.Contents = parseConversionContents(req.Metadata["items"])
					// No order exists yet, so key dedup on the visitor + hour bucket:
					// accidental re-fires within the hour collapse at Meta; a genuine
					// checkout in a later hour is counted.
					ev.EventID = fmt.Sprintf("%s:ic:%d", req.VisitorID, now.Unix()/3600)
				case "add_to_cart", "view_content":
					pid, _ := req.Metadata["productId"].(string)
					price := metaFloat(req.Metadata["price"])
					if pid != "" {
						ev.Contents = []conversion.Content{{ProductID: pid, Quantity: 1, ItemPrice: price}}
						ev.Value = price
						tag := "atc"
						if req.Event == "view_content" {
							tag = "vc"
						}
						// Coarse hour bucket: accidental double-fires within the
						// hour dedup at Meta; genuine repeat views/adds across hours
						// are counted (not collapsed).
						ev.EventID = fmt.Sprintf("%s:%s:%s:%d", req.VisitorID, tag, pid, now.Unix()/3600)
					}
				}
				// Require a dedup key: an order with no orderId, or an add_to_cart
				// with no productId, carries no usable content and cannot be deduped
				// at Meta (retries would double-count). Skip rather than send junk.
				if ev.EventID != "" {
					if results := h.conversions.Send(ev, enabledCreds); len(results) > 0 {
						if req.Metadata == nil {
							req.Metadata = map[string]interface{}{}
						}
						req.Metadata["capi"] = results
					}
				}
			}
		}
	}

	switch req.Event {
	case "contact_request":
		// Honeypot: bots fill the hidden "website" field; humans never do → drop
		// silently (no lead, no alert). Also skip crawlers.
		if hp, _ := req.Metadata["website"].(string); strings.TrimSpace(hp) != "" {
			break
		}
		if isBot {
			break
		}
		get := func(k string) string {
			if v, ok := req.Metadata[k].(string); ok {
				return strings.TrimSpace(v)
			}
			return ""
		}
		// Persist the lead FIRST (system of record) so a failed alert never loses it.
		lead := map[string]interface{}{}
		for _, k := range []string{"name", "email", "company", "sells", "phone", "purpose"} {
			if v := get(k); v != "" {
				lead[k] = v
			}
		}
		if g := req.ClickIDs["gclid"]; g != "" {
			lead["gclid"] = g
		}
		logErr("addContactLead", h.db.AddVisitorMilestone(req.VisitorID, storage.VisitorMilestone{
			Event: "contact_request", Page: req.Page, Date: now, Metadata: lead,
		}))
		// Who gets told depends on where the request came from.
		//
		// A request carrying a sellerId came off THAT merchant's storefront, so it
		// is their lead and not the platform's: a wholesale buyer asking Solomon's
		// for a trade account is of no use in the BusinessCart operator inbox, and
		// routing it there means the merchant never learns a buyer wanted an
		// account.
		//
		// The recipient is the company's own d2c.contactEmail, deliberately, and
		// NOT EMAIL_COMPANY_CONFIGS.ownerEmail which the order notifications use.
		// contactEmail is set by the merchant in their own portal settings, is
		// already published as their public contact address on the storefront
		// footer, contact page and llms.txt, and is set for every storefront-
		// enabled company today. ownerEmail lives in an SSM SecureString that
		// needs a manual edit plus a deploy per merchant, so using it would mean
		// a new customer silently loses wholesale enquiries until someone does
		// ops work. A buyer contacting a business through its website should
		// reach the address that business publishes for exactly that.
		//
		// The lead is already persisted above, so a send failure costs a ping and
		// never the lead itself; logErr records it to CloudWatch and to the
		// visitor's errorLog, so an un-notified request stays findable.
		merchantEmail := ""
		if req.SellerID != "" {
			if oid, err := primitive.ObjectIDFromHex(req.SellerID); err == nil {
				if seller, sErr := h.db.GetAccountByID(oid); sErr == nil && seller != nil &&
					seller.CompanyData != nil && seller.CompanyData.D2C != nil {
					merchantEmail = strings.TrimSpace(seller.CompanyData.D2C.ContactEmail)
				}
			}
		}
		if merchantEmail != "" {
			logErr("tradeLeadNotify", h.emailSender.Send(context.Background(),
				mailer.B2BAccessRequestMessage(merchantEmail, mailer.B2BAccessRequestData{
					Name:    get("name"),
					Company: get("company"),
					Email:   get("email"),
					Phone:   get("phone"),
					Needs:   get("sells"),
				})))
		} else {
			// Either a platform lead (no sellerId, businesscart.ai's own demo
			// funnel, unchanged) or a merchant with no contactEmail set. The
			// fallback is deliberate: a misconfigured merchant must not swallow a
			// buyer's request, so the operator inbox catches it and the subject
			// says why it landed there.
			subject := "New demo request"
			if c := get("company"); c != "" {
				subject += ", " + c
			}
			if req.SellerID != "" {
				subject = "Wholesale request but seller has no contact email, " + get("company")
			}
			body := fmt.Sprintf("New contact / demo request (businesscart.ai)\n\nName:    %s\nEmail:   %s\nCompany: %s\nPhone:   %s\nSells:   %s\nPurpose: %s\nSeller:  %s\ngclid:   %s\n",
				get("name"), get("email"), get("company"), get("phone"), get("sells"), get("purpose"), req.SellerID, get("gclid"))
			logErr("contactLeadNotify", mailer.SendContactLead(h.emailSender, subject, body))
		}
	case "register":
		milestone := storage.VisitorMilestone{Event: "register", Date: now, Metadata: req.Metadata}
		logErr("addMilestone", h.db.AddVisitorMilestone(req.VisitorID, milestone))
		existing, _ := h.db.GetVisitorByID(req.VisitorID)
		if existing != nil {
			days := int(now.Sub(existing.FirstVisit).Hours() / 24)
			logErr("updateConversion", h.db.UpdateVisitorConversion(req.VisitorID, bson.M{
				"registered": true, "registeredAt": now,
				"customerId": req.CustomerID, "daysToRegister": days,
			}))
		}
	case "login":
		if req.CustomerID != "" {
			logErr("linkCustomer", h.db.UpdateVisitorConversion(req.VisitorID, bson.M{"customerId": req.CustomerID}))
		}
	case "add_to_cart":
		milestone := storage.VisitorMilestone{Event: "add_to_cart", Page: req.Page, Date: now, Metadata: req.Metadata}
		logErr("addMilestone", h.db.AddVisitorMilestone(req.VisitorID, milestone))
	case "initiate_checkout":
		milestone := storage.VisitorMilestone{Event: "initiate_checkout", Page: req.Page, Date: now, Metadata: req.Metadata}
		logErr("addMilestone", h.db.AddVisitorMilestone(req.VisitorID, milestone))
	case "checkout_email", "checkout_details", "checkout_address", "checkout_payment", "payment_redirect", "payment_redirect_back",
		// Checkout EXIT steps (Roadmap #41 Phase A2). Phase A instrumented the happy
		// path only, so every exit before checkout_email stayed invisible, including
		// the guest-modal drop that the whole epic was written about. checkout_modal
		// marks the form being shown, checkout_blocked carries a reason, and
		// checkout_abandon carries the stage the shopper left from.
		"checkout_modal", "checkout_blocked", "checkout_abandon":
		// Milestone-only: internal funnel visibility, deliberately NOT sent to ad
		// platforms (see conversion switch above, which maps only 4 event names).
		milestone := storage.VisitorMilestone{Event: req.Event, Page: req.Page, Date: now, Metadata: req.Metadata}
		logErr("addMilestone", h.db.AddVisitorMilestone(req.VisitorID, milestone))
	case "view_content":
		// ViewContent is not persisted as a milestone (avoids per-view bloat under
		// high storefront view volume). Tally successful CAPI sends on a counter
		// for the "Product Views Sent" analytics tile.
		if capi, ok := req.Metadata["capi"].([]conversion.Result); ok {
			sent := 0
			for _, r := range capi {
				if r.Status == "sent" {
					sent++
				}
			}
			if sent > 0 {
				logErr("incViewContentSent", h.db.IncVisitorViewContentSent(req.VisitorID, sent))
			}
		}
	case "order":
		milestone := storage.VisitorMilestone{Event: "order", Date: now, Metadata: req.Metadata}
		logErr("addMilestone", h.db.AddVisitorMilestone(req.VisitorID, milestone))
		amount, _ := req.Metadata["amount"].(float64)
		existing, _ := h.db.GetVisitorByID(req.VisitorID)
		updates := bson.M{"ordered": true, "updatedAt": now}
		if existing != nil {
			if !existing.Ordered {
				updates["firstOrderAt"] = now
				days := int(now.Sub(existing.FirstVisit).Hours() / 24)
				updates["daysToOrder"] = days
			}
			updates["totalOrders"] = existing.TotalOrders + 1
			updates["totalRevenue"] = existing.TotalRevenue + amount
		}
		logErr("updateConversion", h.db.UpdateVisitorConversion(req.VisitorID, updates))
	case "visit":
		milestone := storage.VisitorMilestone{Event: "visit", Page: req.Page, Date: now}
		h.db.AddVisitorMilestone(req.VisitorID, milestone)
	}

	return h.successResponse(map[string]string{"status": "ok"}, http.StatusOK), nil
}

func (h *LambdaHandler) handleVisitors(userClaim map[string]interface{}, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	role, _ := userClaim["role"].(string)
	if role != storage.RoleAdmin && role != storage.RoleCompany {
		return h.errorResponse(http.StatusForbidden, "Access denied"), nil
	}

	// Determine sellerId scope
	// Admin: no param = all data, ?sellerId=portal = portal only, ?sellerId=X = company X
	// Company: forced to their own sellerId
	sellerID := ""
	if role == storage.RoleCompany {
		// The organisation, not the individual login: visitor data is keyed by the
		// root's id like every other seller-scoped record, so a colleague scoping
		// by their own account would see no traffic at all.
		sellerID = orgIDFromClaim(userClaim)
		if sellerID == "" {
			return h.errorResponse(http.StatusForbidden, "Invalid account"), nil
		}
	} else if role == storage.RoleAdmin {
		sellerID = request.QueryStringParameters["sellerId"]
	}

	since := request.QueryStringParameters["since"]

	switch {
	case request.Path == "/visitors/stats" && request.HTTPMethod == "GET":
		return h.getVisitorStats(sellerID, since)
	case request.Path == "/visitors" && request.HTTPMethod == "GET":
		return h.getVisitors(request, sellerID, since)
	case request.Path == "/visitors" && request.HTTPMethod == "DELETE" && role == storage.RoleAdmin:
		vid := request.QueryStringParameters["visitorId"]
		if vid == "" {
			return h.errorResponse(http.StatusBadRequest, "visitorId required"), nil
		}
		if err := h.db.DeleteVisitor(vid); err != nil {
			return h.errorResponse(http.StatusInternalServerError, "Failed to delete visitor"), nil
		}
		return h.successResponse(map[string]string{"status": "deleted"}, http.StatusOK), nil
	}
	return h.errorResponse(http.StatusNotFound, "Route not found"), nil
}

func (h *LambdaHandler) getVisitorStats(sellerID, since string) (events.APIGatewayProxyResponse, error) {
	stats, err := h.db.GetVisitorStats(sellerID, since)
	if err != nil {
		log.Printf("ERROR: GetVisitorStats: %v", err)
		return h.errorResponse(http.StatusInternalServerError, "Failed to get visitor stats"), nil
	}
	return h.successResponse(stats, http.StatusOK), nil
}

func (h *LambdaHandler) getVisitors(request events.APIGatewayProxyRequest, sellerID, since string) (events.APIGatewayProxyResponse, error) {
	filter := bson.M{}
	if sellerID == "portal" {
		filter["sellerId"] = bson.M{"$in": []interface{}{nil, ""}}
	} else if sellerID != "" {
		filter["sellerId"] = sellerID
	}

	// Time range filter
	if since != "" {
		var sinceTime time.Time
		switch since {
		case "24h":
			sinceTime = time.Now().Add(-24 * time.Hour)
		case "7d":
			sinceTime = time.Now().AddDate(0, 0, -7)
		case "30d":
			sinceTime = time.Now().AddDate(0, 0, -30)
		case "mtd":
			// Calendar month to date. Must stay in step with the identical switch in
			// storage.GetVisitorStats, or the visitor list and the stat cards above it
			// would silently cover different periods.
			n := time.Now()
			sinceTime = time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, n.Location())
		}
		if !sinceTime.IsZero() {
			filter["lastVisit"] = bson.M{"$gte": sinceTime}
		}
	}

	q := request.QueryStringParameters

	// Filter by source
	if v := q["source"]; v != "" {
		filter["attribution.source"] = v
	}
	// Filter by country
	if v := q["country"]; v != "" {
		filter["geo.country"] = v
	}
	// Filter by device
	if v := q["device"]; v != "" {
		filter["device"] = v
	}
	// Filter bots
	if v := q["isBot"]; v == "true" {
		filter["isBot"] = true
	} else if v == "false" {
		filter["isBot"] = false
	}
	// Filter registered
	if v := q["registered"]; v == "true" {
		filter["registered"] = true
	}
	// Filter ordered
	if v := q["ordered"]; v == "true" {
		filter["ordered"] = true
	}
	// Filter added-to-cart: any visitor whose milestones include an add_to_cart event.
	if v := q["addedToCart"]; v == "true" {
		filter["milestones.event"] = "add_to_cart"
	}
	// Filter contacted-us: portal visitor reached /contact-us after landing elsewhere.
	if v := q["contactedUs"]; v == "true" {
		filter["pages"] = "/contact-us"
		filter["attribution.landingPage"] = bson.M{"$ne": "/contact-us"}
	}
	// Filter by milestone event. "any" means "did something at all", which drops the
	// one-page passers-by and crawlers that make up most of the collection; any other
	// value matches that single event name. Skipped when addedToCart above already
	// claimed milestones.event, so the two can never overwrite each other.
	if v := q["event"]; v != "" && filter["milestones.event"] == nil {
		if v == "any" {
			filter["milestones.0"] = bson.M{"$exists": true}
		} else {
			filter["milestones.event"] = v
		}
	}
	// Search by visitorId
	if v := q["visitorId"]; v != "" {
		filter["visitorId"] = v
	}

	page := int64(1)
	if v := q["page"]; v != "" {
		var p int64
		if _, err := fmt.Sscanf(v, "%d", &p); err == nil && p > 0 {
			page = p
		}
	}
	perPage := int64(50)
	if v := q["perPage"]; v != "" {
		var pp int64
		if _, err := fmt.Sscanf(v, "%d", &pp); err == nil && pp > 0 && pp <= 100 {
			perPage = pp
		}
	}

	skip := (page - 1) * perPage
	visitors, total, err := h.db.GetVisitors(filter, skip, perPage)
	if err != nil {
		log.Printf("ERROR: GetVisitors: %v", err)
		return h.errorResponse(http.StatusInternalServerError, "Failed to get visitors"), nil
	}

	return h.successResponse(map[string]interface{}{
		"visitors": visitors,
		"total":    total,
		"page":     page,
		"perPage":  perPage,
	}, http.StatusOK), nil
}

// validateCompanyFieldTypes enforces the API contract: payload fields with
// known types in CompanyData must arrive as that type. Empty strings for
// numeric fields, strings for booleans, etc. are rejected with 400 BEFORE
// any DB write — preventing the silent corruption pattern where a cleared
// <input type=number> on the admin form sends "" and the BSON decoder later
// 500s on every read of that doc.
//
// Rules:
//   - numericFields: must be float64 if present and non-null
//   - booleanFields: must be bool if present and non-null
//   - null is allowed for any optional field (clears it)
//   - missing fields are allowed (partial update — backward compatible)
//   - any other field passes through unchanged (string sanitization, D2C,
//     customerGroups validation are handled downstream as before)
func validateCompanyFieldTypes(company map[string]interface{}) error {
	numericFields := []string{
		"shippingRate", "taxRate", "creditLimit", "leadTime",
		"minOrderAmountLimit", "maxOrderAmountLimit",
		"minOrderQuantityLimit", "maxOrderQuantityLimit",
		"monthlyOrderLimit", "yearlyOrderLimit",
	}
	for _, field := range numericFields {
		v, ok := company[field]
		if !ok || v == nil {
			continue
		}
		if _, isNum := v.(float64); !isNum {
			return fmt.Errorf("%s must be a number, got %T (%v)", field, v, v)
		}
	}

	booleanFields := []string{"taxableGoods", "quotesAllowed", "couponsEnabled"}
	for _, field := range booleanFields {
		v, ok := company[field]
		if !ok || v == nil {
			continue
		}
		if _, isBool := v.(bool); !isBool {
			return fmt.Errorf("%s must be a boolean, got %T (%v)", field, v, v)
		}
	}

	return nil
}

// Bounds on an approval chain. Deep chains are an anti-pattern (over-engineered
// approval routing is the most commonly reported B2B misconfiguration), and the
// resolved chain rides in the JWT, so a cap keeps every request small.
const (
	MaxApprovalSteps    = 5
	MaxApproversPerStep = 10
)

// resolveApprovers turns the emails on a policy into real accounts.
//
// The caller supplies addresses of people they already work with; this fills in
// the account id and display name. Anything the client sent as an id is
// discarded, so a policy can never point at an account the setter merely guessed.
//
// Approvers must share the role of the account being configured AND belong to the
// same organisation. Sign-off happens inside an organisation, so a buyer's chain
// names colleagues at the buyer and a seller's names colleagues at the seller.
func (h *LambdaHandler) resolveApprovers(p *storage.ApprovalPolicy, setter *storage.Account, setterRole string) error {
	if p == nil {
		return nil
	}
	for i := range p.Chain {
		for j := range p.Chain[i].Approvers {
			a := &p.Chain[i].Approvers[j]
			email := strings.ToLower(strings.TrimSpace(a.Email))
			if email == "" {
				return fmt.Errorf("approval level %d approver %d needs an email address", i+1, j+1)
			}
			acc, err := h.db.GetAccountByEmail(email)
			if err != nil {
				return fmt.Errorf("no account found for %s; they must be registered before they can approve", email)
			}
			if string(acc.Role) != setterRole {
				return fmt.Errorf("%s cannot approve for your organisation", email)
			}
			// Naming an approver grants them sight of this organisation's quotes
			// while those await a decision, so it must be a colleague — someone in
			// the same organisation. This replaces an earlier proxy ("shares a
			// supplier"), which was the closest the data model could get before
			// organisation membership existed and would still have admitted an
			// unrelated customer of the same supplier.
			if acc.OrgID() != setter.OrgID() {
				return fmt.Errorf("%s is not part of your organisation", email)
			}
			a.AccountID = acc.ID.Hex()
			a.Email = email
			a.Name = acc.Name
		}
	}
	return nil
}

// validateApprovalScope rejects a scope outside the known vocabulary.
//
// Without it a typo (or a trailing space) stores happily and then fails the scope
// comparison at quote time forever: the organisation sees a configured policy,
// gets no error anywhere, and no order is ever held.
func validateApprovalScope(scope string) error {
	switch scope {
	case "", storage.ApprovalScopeNone, storage.ApprovalScopeStandard,
		storage.ApprovalScopeNegotiable, storage.ApprovalScopeBoth:
		return nil
	}
	return fmt.Errorf("scope must be one of none, standard, negotiable, both (got %q)", scope)
}

// validateApprovalPolicyBounds rejects a policy that is the wrong SHAPE, using
// only what the request itself carries.
//
// Split out so it can run BEFORE resolveApprovers, which issues one
// GetAccountByEmail per named approver and has no cap of its own: a chain of
// 500 levels x 500 approvers would otherwise run 250k Mongo queries inside a
// single Lambda invocation before anything rejected it as too large.
//
// It deliberately does NOT check account id or email. Those are what
// resolveApprovers fills in, so requiring them here would reject every valid
// policy. That is exactly what happened when the two calls were simply swapped.
func validateApprovalPolicyBounds(p *storage.ApprovalPolicy) error {
	if p == nil {
		return nil
	}
	if err := validateApprovalScope(p.Scope); err != nil {
		return err
	}
	if p.Threshold < 0 || p.QuantityThreshold < 0 || p.ValidityHours < 0 {
		return fmt.Errorf("approval thresholds and validity hours cannot be negative")
	}
	if len(p.Chain) > MaxApprovalSteps {
		return fmt.Errorf("an approval chain supports at most %d levels, got %d", MaxApprovalSteps, len(p.Chain))
	}
	for i, step := range p.Chain {
		if len(step.Approvers) == 0 {
			return fmt.Errorf("approval level %d has no approvers; it could never be cleared", i+1)
		}
		if len(step.Approvers) > MaxApproversPerStep {
			return fmt.Errorf("approval level %d supports at most %d approvers, got %d", i+1, MaxApproversPerStep, len(step.Approvers))
		}
	}
	return nil
}

// validateApprovalPolicy rejects a malformed policy at the API boundary so the DB
// never holds a value that later fails to decode or can never be satisfied.
//
// Runs AFTER resolveApprovers, because the identity checks below are checks on
// what resolution produced.
func validateApprovalPolicy(p *storage.ApprovalPolicy) error {
	if p == nil {
		return nil
	}
	if err := validateApprovalPolicyBounds(p); err != nil {
		return err
	}
	for i, step := range p.Chain {
		for j, a := range step.Approvers {
			if strings.TrimSpace(a.AccountID) == "" {
				return fmt.Errorf("approval level %d approver %d is missing an account", i+1, j+1)
			}
			// checkout-service addresses approval mail from its own denormalised
			// copy and must never call back here, so a missing address means an
			// approver who silently never gets told.
			if strings.TrimSpace(a.Email) == "" {
				return fmt.Errorf("approval level %d approver %d is missing an email, so they could not be notified", i+1, j+1)
			}
		}
	}
	return nil
}

// isEmptyApprovalPolicy reports a policy that would gate nothing, so it can be
// unset rather than stored as noise.
func isEmptyApprovalPolicy(p *storage.ApprovalPolicy) bool {
	return len(p.Chain) == 0 && p.Threshold == 0 && p.QuantityThreshold == 0 &&
		(p.Scope == "" || p.Scope == storage.ApprovalScopeNone)
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("Password must be at least 8 characters")
	}
	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, c := range password {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasDigit = true
		case unicode.IsPunct(c) || unicode.IsSymbol(c):
			hasSpecial = true
		}
	}
	if !hasUpper {
		return fmt.Errorf("Password must contain at least one uppercase letter")
	}
	if !hasLower {
		return fmt.Errorf("Password must contain at least one lowercase letter")
	}
	if !hasDigit {
		return fmt.Errorf("Password must contain at least one digit")
	}
	if !hasSpecial {
		return fmt.Errorf("Password must contain at least one special character")
	}
	return nil
}

func parseUserAgent(ua string) (browser, os string) {
	ua = strings.ToLower(ua)
	// Browser
	switch {
	case strings.Contains(ua, "chrome") && !strings.Contains(ua, "edg"):
		browser = "Chrome"
	case strings.Contains(ua, "safari") && !strings.Contains(ua, "chrome"):
		browser = "Safari"
	case strings.Contains(ua, "firefox"):
		browser = "Firefox"
	case strings.Contains(ua, "edg"):
		browser = "Edge"
	default:
		browser = "Other"
	}
	// OS
	switch {
	case strings.Contains(ua, "windows"):
		os = "Windows"
	case strings.Contains(ua, "macintosh") || strings.Contains(ua, "mac os"):
		os = "macOS"
	case strings.Contains(ua, "linux") && !strings.Contains(ua, "android"):
		os = "Linux"
	case strings.Contains(ua, "android"):
		os = "Android"
	case strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad"):
		os = "iOS"
	default:
		os = "Other"
	}
	return
}

func detectBot(ua, asn string) (bool, string) {
	bots := map[string]string{
		"googlebot": "Googlebot", "bingbot": "Bingbot", "gptbot": "GPTBot",
		"perplexitybot": "PerplexityBot", "claudebot": "ClaudeBot", "ccbot": "CCBot",
		"twitterbot": "Twitterbot", "facebookexternalhit": "FacebookBot",
		"linkedinbot": "LinkedInBot", "slackbot": "Slackbot", "whatsapp": "WhatsApp",
		"yandexbot": "YandexBot", "duckduckbot": "DuckDuckBot", "applebot": "AppleBot",
		"semrushbot": "SemrushBot", "ahrefsbot": "AhrefsBot",
		// Storebot-Google is Google's shopping crawler and it DRIVES CHECKOUT: it
		// adds to cart and taps checkout to verify the flow. Its UA contains
		// "Mozilla", so the datacenter-ASN rule below never caught it, and its
		// synthetic add_to_cart / initiate_checkout were dispatched to Meta as real
		// conversions (12 sends confirmed in prod). Teaching the bidder to buy
		// traffic that looks like a crawler.
		"storebot-google": "Storebot-Google", "google-inspectiontool": "Google-InspectionTool",
		// Agents that fetch pages on a user's behalf. They are not shoppers and must
		// never reach the conversion path.
		"chatgpt-user": "ChatGPT-User", "oai-searchbot": "OAI-SearchBot",
		"perplexity-user": "Perplexity-User", "google-extended": "Google-Extended",
		"bytespider": "Bytespider", "amazonbot": "Amazonbot", "meta-externalagent": "MetaExternalAgent",
	}
	lower := strings.ToLower(ua)
	for key, name := range bots {
		if strings.Contains(lower, key) {
			return true, name
		}
	}
	// Known datacenter ASNs (likely bots)
	botASNs := map[string]bool{"16509": true, "14618": true, "15169": true, "8075": true}
	if botASNs[asn] && !strings.Contains(lower, "mozilla") {
		return true, "datacenter"
	}
	return false, ""
}

// resolveSourceMedium picks the channel for a visit: explicit UTM values win,
// then the referrer, then "direct".
//
// The empty-medium case is the subtle one. Platforms that decorate their own
// outbound links send a utm_source and no utm_medium — ChatGPT appends
// "?utm_source=chatgpt.com" and nothing else. That used to skip inferSource
// entirely (the old guard was `if source == ""`) and store medium as an empty
// string, so those visits rendered as an unlabelled channel and could never show
// up as llm. Classify the utm_source value itself first, fall back to the
// referrer, and only then settle for "referral".
//
// Campaigns that set both values are untouched: the empty-medium branch cannot
// fire for them, so google/cpc, fb/paid and ig/paid keep behaving exactly as before.
func resolveSourceMedium(utmSource, utmMedium, referrer string) (source, medium string) {
	source, medium = utmSource, utmMedium
	if source == "" && referrer != "" {
		source, medium = inferSource(referrer)
	}
	if source != "" && medium == "" {
		// inferSource returns "referral" as its give-up value, so anything else
		// means it actually recognised the token.
		if s, m := inferSource(source); m != "referral" {
			source, medium = s, m
		} else if referrer != "" {
			if _, m := inferSource(referrer); m != "referral" {
				medium = m
			}
		}
		if medium == "" {
			medium = "referral"
		}
	}
	if source == "" {
		source = "direct"
		medium = "direct"
	}
	return source, medium
}

func inferSource(referrer string) (source, medium string) {
	r := strings.ToLower(referrer)
	switch {
	// LLM assistants are matched FIRST. Several of their hosts contain substrings
	// that the search/social cases below would otherwise swallow, which silently
	// misfiled every such visit:
	//   "chatgpt.com" contains "t.co"      -> was returning twitter/social
	//   "gemini.google.com" contains "google." -> was returning google/organic
	// Order is the fix; these cases were unreachable where they used to sit.
	case strings.Contains(r, "chat.openai.com") || strings.Contains(r, "chatgpt.com"):
		return "chatgpt", "llm"
	case strings.Contains(r, "perplexity.ai"):
		return "perplexity", "llm"
	case strings.Contains(r, "claude.ai"):
		return "claude", "llm"
	// vertexaisearch.cloud.google.com is the redirect host behind Gemini's
	// grounded citations, so it carries genuine Gemini referrals.
	case strings.Contains(r, "gemini.google.com") || strings.Contains(r, "vertexaisearch.cloud.google.com"):
		return "gemini", "llm"
	case strings.Contains(r, "copilot.microsoft.com"):
		return "copilot", "llm"
	case strings.Contains(r, "meta.ai"):
		return "meta-ai", "llm"
	// A bare "x.ai" matched any host containing it (linux.ai, phoenix.ai both
	// classified as grok), so anchor on the real Grok hosts instead.
	case strings.Contains(r, "grok.com") || strings.Contains(r, "grok.x.ai"):
		return "grok", "llm"
	case strings.Contains(r, "you.com"):
		return "you", "llm"
	case strings.Contains(r, "phind.com"):
		return "phind", "llm"
	case strings.Contains(r, "deepseek.com"):
		return "deepseek", "llm"
	case strings.Contains(r, "poe.com"):
		return "poe", "llm"
	case strings.Contains(r, "mistral.ai"):
		return "mistral", "llm"
	// Search engines. Brave and Kagi belong HERE, not in the llm block above: both
	// are general keyword search engines that happen to ship an AI assistant, so
	// filing an ordinary search as llm would permanently inflate the very channel
	// this classifier exists to measure (attribution is written once, on insert).
	case strings.Contains(r, "google."):
		return "google", "organic"
	case strings.Contains(r, "bing."):
		return "bing", "organic"
	case strings.Contains(r, "duckduckgo.com"):
		return "duckduckgo", "organic"
	case strings.Contains(r, "search.brave.com"):
		return "brave", "organic"
	case strings.Contains(r, "kagi.com"):
		return "kagi", "organic"
	case strings.Contains(r, "yahoo."):
		return "yahoo", "organic"
	// Social.
	case strings.Contains(r, "reddit.com"):
		return "reddit", "social"
	case strings.Contains(r, "linkedin.com"):
		return "linkedin", "social"
	case strings.Contains(r, "facebook.com") || strings.Contains(r, "fb.com"):
		return "facebook", "social"
	case strings.Contains(r, "instagram.com"):
		return "instagram", "social"
	// "t.co" is a substring of every host ending in "t.com", so anchor it to the
	// actual link-shortener URL rather than matching it anywhere in the string.
	case strings.Contains(r, "twitter.com") || strings.Contains(r, "//t.co/") || strings.HasSuffix(r, "//t.co"):
		return "twitter", "social"
	case strings.Contains(r, "youtube.com"):
		return "youtube", "social"
	case strings.Contains(r, "tiktok.com"):
		return "tiktok", "social"
	case strings.Contains(r, "wa.me") || strings.Contains(r, "whatsapp.com"):
		return "whatsapp", "social"
	default:
		return "referral", "referral"
	}
}
