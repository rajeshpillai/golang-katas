package models

type Kata struct {
	ID              string `json:"id"`
	Phase           int    `json:"phase"`
	PhaseTitle      string `json:"phase_title"`
	Sequence        int    `json:"sequence"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	BrokenCode      string `json:"broken_code"`
	CorrectCode     string `json:"correct_code"`
	Explanation     string `json:"explanation"`
	DesignTradeoff  string `json:"design_tradeoff"`
}

type KataSummary struct {
	ID       string `json:"id"`
	Sequence int    `json:"sequence"`
	Title    string `json:"title"`
}

type PhaseGroup struct {
	Phase int           `json:"phase"`
	Title string        `json:"title"`
	Katas []KataSummary `json:"katas"`
}

type KataListResponse struct {
	Phases []PhaseGroup `json:"phases"`
}
