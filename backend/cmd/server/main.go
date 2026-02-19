package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"golang-katas/backend/internal/handlers"
	"golang-katas/backend/internal/middleware"
	"golang-katas/backend/internal/services"
)

func main() {
	contentDir := "../../content"
	if dir := os.Getenv("CONTENT_DIR"); dir != "" {
		contentDir = dir
	}

	katas, err := services.LoadAllKatas(contentDir)
	if err != nil {
		log.Fatalf("Failed to load katas: %v", err)
	}
	log.Printf("Loaded %d katas", len(katas))

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/katas", handlers.ListKatas(katas))
	mux.HandleFunc("GET /api/katas/{id}", handlers.GetKata(katas))
	mux.HandleFunc("POST /api/playground/run", handlers.RunCode())
	mux.HandleFunc("GET /api/health", handlers.Health())

	frontendDir := "../../frontend/dist"
	if dir := os.Getenv("FRONTEND_DIR"); dir != "" {
		frontendDir = dir
	}
	mux.Handle("/", http.FileServer(http.Dir(frontendDir)))

	handler := middleware.Logger(middleware.CORS(mux))

	port := os.Getenv("PORT")
	if port == "" {
		port = "6000"
	}

	addr := fmt.Sprintf(":%s", port)
	log.Printf("Server running on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}
