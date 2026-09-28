package strava

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

// UploadParams describe the activity Strava creates from a FIT file.
type UploadParams struct {
	Name        string
	Description string
	// ExternalID makes retries idempotent on Strava's side (duplicate detection keys on it too).
	ExternalID string
}

// Upload is Strava's upload status.
type Upload struct {
	ID         int64  `json:"id"`
	Error      string `json:"error"`
	Status     string `json:"status"`
	ActivityID int64  `json:"activity_id"`
}

// Upload sends a FIT file as an indoor ride.
func (c *Client) Upload(ctx context.Context, accessToken string, fit []byte, p UploadParams) (Upload, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fields := map[string]string{
		"data_type":   "fit",
		"name":        p.Name,
		"description": p.Description,
		"trainer":     "1", // indoor: no GPS
		"sport_type":  "Ride",
		"external_id": p.ExternalID,
	}
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			return Upload{}, err
		}
	}
	fw, err := mw.CreateFormFile("file", p.ExternalID)
	if err != nil {
		return Upload{}, err
	}
	if _, err := fw.Write(fit); err != nil {
		return Upload{}, err
	}
	if err := mw.Close(); err != nil {
		return Upload{}, err
	}
	var u Upload
	err = c.do(ctx, http.MethodPost, "/api/v3/uploads", accessToken, &body, mw.FormDataContentType(), &u)
	return u, err
}

func (c *Client) UploadStatus(ctx context.Context, accessToken string, id int64) (Upload, error) {
	var u Upload
	err := c.do(ctx, http.MethodGet, "/api/v3/uploads/"+strconv.FormatInt(id, 10), accessToken, nil, "", &u)
	return u, err
}

var duplicateOf = regexp.MustCompile(`duplicate of .*?/activities/(\d+)`)

// DuplicateActivity extracts the existing activity ID from Strava's duplicate error, if any.
func DuplicateActivity(uploadError string) (int64, bool) {
	m := duplicateOf.FindStringSubmatch(uploadError)
	if m == nil {
		return 0, false
	}
	id, err := strconv.ParseInt(m[1], 10, 64)
	return id, err == nil
}

// WaitForActivity polls an upload until Strava assigns an activity ID or reports an error.
// Strava suggests ≥ 1 s between polls; processing usually takes under 2 s.
func (c *Client) WaitForActivity(ctx context.Context, accessToken string, u Upload, interval time.Duration) (Upload, error) {
	for u.ActivityID == 0 && u.Error == "" {
		select {
		case <-ctx.Done():
			return u, ctx.Err()
		case <-time.After(interval):
		}
		var err error
		if u, err = c.UploadStatus(ctx, accessToken, u.ID); err != nil {
			return u, err
		}
	}
	return u, nil
}
