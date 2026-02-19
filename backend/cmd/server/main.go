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

func findDir(envKey string, candidates []string) string {
	if dir := os.Getenv(envKey); dir != "" {
		return dir
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c
		}
	}
	return candidates[0]
}

func main() {
	contentDir := findDir("CONTENT_DIR", []string{"content", "../content", "../../content"})

	katas, err := services.LoadAllKatas(contentDir)
	if err != nil {
		log.Fatalf("Failed to load katas from %s: %v", contentDir, err)
	}
	log.Printf("Loaded %d katas from %s", len(katas), contentDir)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/katas", handlers.ListKatas(katas))
	mux.HandleFunc("GET /api/katas/{id}", handlers.GetKata(katas))
	mux.HandleFunc("POST /api/playground/run", handlers.RunCode())
	mux.HandleFunc("GET /api/health", handlers.Health())

	frontendDir := findDir("FRONTEND_DIR", []string{"frontend/dist", "../frontend/dist", "../../frontend/dist"})
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
