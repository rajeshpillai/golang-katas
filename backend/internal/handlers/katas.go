package handlers

import (
	"encoding/json"
	"net/http"

	"golang-katas/backend/internal/models"
)

func ListKatas(katas []models.Kata) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		phaseMap := make(map[int]*models.PhaseGroup)
		var phaseOrder []int

		for _, k := range katas {
			pg, exists := phaseMap[k.Phase]
			if !exists {
				pg = &models.PhaseGroup{
					Phase: k.Phase,
					Title: k.PhaseTitle,
				}
				phaseMap[k.Phase] = pg
				phaseOrder = append(phaseOrder, k.Phase)
			}
			pg.Katas = append(pg.Katas, models.KataSummary{
				ID:       k.ID,
				Sequence: k.Sequence,
				Title:    k.Title,
			})
		}

		var phases []models.PhaseGroup
		for _, p := range phaseOrder {
			phases = append(phases, *phaseMap[p])
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.KataListResponse{Phases: phases})
	}
}

func GetKata(katas []models.Kata) http.HandlerFunc {
	kataMap := make(map[string]models.Kata)
	for _, k := range katas {
		kataMap[k.ID] = k
	}

	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		kata, ok := kataMap[id]
		if !ok {
			http.Error(w, `{"error":"kata not found"}`, http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(kata)
	}
}
