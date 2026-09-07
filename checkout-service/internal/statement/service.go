package statement

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Service struct {
	collection *mongo.Collection
}

func NewService(db *mongo.Database) *Service {
	return &Service{collection: db.Collection("statements")}
}

// Save inserts a new statement snapshot. The mongo driver returns the new
// _id but does NOT write it back to the struct, so we copy it ourselves —
// callers (handler response, test cleanup) need a usable id.
func (s *Service) Save(stmt *Statement) (*Statement, error) {
	res, err := s.collection.InsertOne(context.Background(), stmt)
	if err != nil {
		return nil, err
	}
	if oid, ok := res.InsertedID.(primitive.ObjectID); ok {
		stmt.ID = oid
	}
	return stmt, nil
}

// Delete removes a statement by ID. Admin retraction path (a statement was
// sent in error). Returns true if a doc was deleted.
func (s *Service) Delete(id primitive.ObjectID) (bool, error) {
	res, err := s.collection.DeleteOne(context.Background(), bson.M{"_id": id})
	if err != nil {
		return false, err
	}
	return res.DeletedCount > 0, nil
}

// ListBySeller returns sent statements for a seller, newest first.
// limit=0 means no limit.
func (s *Service) ListBySeller(sellerID string, limit int64) ([]*Statement, error) {
	opts := options.Find().SetSort(bson.D{{Key: "sentAt", Value: -1}})
	if limit > 0 {
		opts.SetLimit(limit)
	}
	cursor, err := s.collection.Find(context.Background(), bson.M{"sellerId": sellerID}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	var out []*Statement
	if err := cursor.All(context.Background(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// FindByPeriod returns the most recently sent statement already covering this
// exact period for this seller, or nil when none exists.
//
// The send path calls this BEFORE the email goes out. That ordering is the whole
// point: Save runs only after a successful send, so a guard that fired at insert
// time would leave the customer holding a second invoice we have no record of.
//
// This is the guard, not a unique index. No collection in this service carries
// an index beyond _id_ and the codebase has no migration or index-bootstrap
// mechanism at all, so adding one is a deliberate decision about how indexes get
// managed here rather than a line to slip into a feature branch. Without it two
// genuinely concurrent sends could still both pass this check; with one admin
// clicking a button that race is not the failure mode in play.
func (s *Service) FindByPeriod(sellerID string, from, to time.Time) (*Statement, error) {
	opts := options.FindOne().SetSort(bson.D{{Key: "sentAt", Value: -1}})
	var out Statement
	err := s.collection.FindOne(context.Background(), bson.M{
		"sellerId":    sellerID,
		"periodStart": from,
		"periodEnd":   to,
	}, opts).Decode(&out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// SetPaid marks a statement settled, or clears that mark when paid is false.
//
// PaidAt and PaymentReference were reserved on the model from the start so that
// payment tracking would need no migration. This is the write path they were
// waiting for. Clearing unsets both rather than storing a zero value, so a
// mistaken mark leaves nothing behind and omitempty keeps the document clean.
func (s *Service) SetPaid(id primitive.ObjectID, paid bool, reference string) (*Statement, error) {
	var update bson.M
	if paid {
		set := bson.M{"paidAt": time.Now().UTC()}
		update = bson.M{"$set": set}
		if reference != "" {
			set["paymentReference"] = reference
		} else {
			update["$unset"] = bson.M{"paymentReference": ""}
		}
	} else {
		update = bson.M{"$unset": bson.M{"paidAt": "", "paymentReference": ""}}
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var out Statement
	err := s.collection.FindOneAndUpdate(context.Background(), bson.M{"_id": id}, update, opts).Decode(&out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}
