package services

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang-katas/backend/internal/models"

	"gopkg.in/yaml.v3"
)

type kataFrontmatter struct {
	ID         string `yaml:"id"`
	Phase      int    `yaml:"phase"`
	PhaseTitle string `yaml:"phase_title"`
	Sequence   int    `yaml:"sequence"`
	Title      string `yaml:"title"`
}

func LoadAllKatas(contentDir string) ([]models.Kata, error) {
	entries, err := os.ReadDir(contentDir)
	if err != nil {
		return nil, fmt.Errorf("reading content dir: %w", err)
	}

	var phaseDirs []string
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "phase-") {
			phaseDirs = append(phaseDirs, e.Name())
		}
	}
	sort.Strings(phaseDirs)

	var katas []models.Kata
	for _, dir := range phaseDirs {
		dirPath := filepath.Join(contentDir, dir)
		files, err := os.ReadDir(dirPath)
		if err != nil {
			return nil, fmt.Errorf("reading phase dir %s: %w", dir, err)
		}

		var mdFiles []string
		for _, f := range files {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".md") {
				mdFiles = append(mdFiles, f.Name())
			}
		}
		sort.Strings(mdFiles)

		for _, file := range mdFiles {
			filePath := filepath.Join(dirPath, file)
			kata, err := parseKataFile(filePath)
			if err != nil {
				return nil, fmt.Errorf("parsing %s: %w", filePath, err)
			}
			katas = append(katas, kata)
		}
	}

	return katas, nil
}

func parseKataFile(path string) (models.Kata, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return models.Kata{}, err
	}

	content := string(data)

	fm, body, err := parseFrontmatter(content)
	if err != nil {
		return models.Kata{}, fmt.Errorf("frontmatter: %w", err)
	}

	sections := parseSections(body)

	return models.Kata{
		ID:              fm.ID,
		Phase:           fm.Phase,
		PhaseTitle:      fm.PhaseTitle,
		Sequence:        fm.Sequence,
		Title:           fm.Title,
		Description:     strings.TrimSpace(sections["Description"]),
		BrokenCode:      extractCodeBlock(sections["Broken Code"]),
		CorrectCode:     extractCodeBlock(sections["Correct Code"]),
		Explanation:     strings.TrimSpace(sections["Explanation"]),
		DesignTradeoff:  strings.TrimSpace(sections["Design Tradeoff"]),
	}, nil
}

func parseFrontmatter(content string) (kataFrontmatter, string, error) {
	var fm kataFrontmatter

	if !strings.HasPrefix(strings.TrimSpace(content), "---") {
		return fm, content, fmt.Errorf("no frontmatter found")
	}

	trimmed := strings.TrimSpace(content)
	parts := strings.SplitN(trimmed[3:], "---", 2)
	if len(parts) < 2 {
		return fm, content, fmt.Errorf("unclosed frontmatter")
	}

	if err := yaml.Unmarshal([]byte(parts[0]), &fm); err != nil {
		return fm, content, fmt.Errorf("yaml parse: %w", err)
	}

	return fm, strings.TrimSpace(parts[1]), nil
}

func parseSections(body string) map[string]string {
	sections := make(map[string]string)
	lines := strings.Split(body, "\n")

	var currentSection string
	var currentContent []string

	for _, line := range lines {
		if strings.HasPrefix(line, "## ") {
			if currentSection != "" {
				sections[currentSection] = strings.Join(currentContent, "\n")
			}
			currentSection = strings.TrimPrefix(line, "## ")
			currentContent = nil
		} else {
			currentContent = append(currentContent, line)
		}
	}

	if currentSection != "" {
		sections[currentSection] = strings.Join(currentContent, "\n")
	}

	return sections
}

func extractCodeBlock(section string) string {
	lines := strings.Split(section, "\n")
	var code []string
	inBlock := false

	for _, line := range lines {
		if strings.HasPrefix(line, "```go") {
			inBlock = true
			continue
		}
		if inBlock && strings.HasPrefix(line, "```") {
			break
		}
		if inBlock {
			code = append(code, line)
		}
	}

	return strings.Join(code, "\n")
}
