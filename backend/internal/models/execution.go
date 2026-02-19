package models

type ExecutionRequest struct {
	Code string `json:"code"`
}

type ExecutionResult struct {
	Stdout          string `json:"stdout"`
	Stderr          string `json:"stderr"`
	Success         bool   `json:"success"`
	ExecutionTimeMs int64  `json:"execution_time_ms"`
	Error           string `json:"error,omitempty"`
}
