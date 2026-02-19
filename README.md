# Golang Katas

A structured learning platform for Go, organized into 17 phases — from syntax basics to advanced systems patterns. Each kata includes detailed explanations, broken code to diagnose, and idiomatic solutions to study.

## Prerequisites

- [Go](https://go.dev/dl/) 1.22 or later
- [Node.js](https://nodejs.org/) 18 or later
- npm (comes with Node.js)

## Project Structure

```
golang-katas/
├── backend/          # Go API server (net/http)
├── frontend/         # Solid.js + TypeScript + Tailwind CSS
└── content/          # Kata markdown files (YAML frontmatter + sections)
```

## Running Locally

### 1. Install frontend dependencies

```bash
cd frontend
npm install
```

### 2. Start the backend

```bash
cd backend
CONTENT_DIR=../content go run ./cmd/server/main.go
```

The backend starts on **http://localhost:6000**.

### 3. Start the frontend dev server

In a separate terminal:

```bash
cd frontend
npm run dev
```

The frontend starts on **http://localhost:5173** and proxies API requests to the backend.

### 4. Open the app

Visit **http://localhost:5173** in your browser.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/katas` | GET | List all katas grouped by phase |
| `/api/katas/{id}` | GET | Get a single kata with full content |
| `/api/playground/run` | POST | Execute Go code and return output |

## Building for Production

```bash
# Build the frontend
cd frontend
npm run build

# Run the backend serving the built frontend
cd ../backend
CONTENT_DIR=../content FRONTEND_DIR=../frontend/dist go run ./cmd/server/main.go
```

Then visit **http://localhost:6000**.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `6000` | Backend server port |
| `CONTENT_DIR` | `../../content` | Path to kata content directory |
| `FRONTEND_DIR` | `../../frontend/dist` | Path to built frontend assets |
