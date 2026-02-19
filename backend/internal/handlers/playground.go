package handlers

import (
	"encoding/json"
	"net/http"

	"golang-katas/backend/internal/models"
	"golang-katas/backend/internal/services"
)

func RunCode() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req models.ExecutionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
			return
		}

		if req.Code == "" {
			http.Error(w, `{"error":"code is required"}`, http.StatusBadRequest)
			return
		}

		result := services.ExecuteGoCode(req.Code)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}
