package main

import (
	"encoding/json"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
)

// --- SHARED DATA STRUCTURES ---

type ScraperConfig struct {
	Meta       MetaConfig       `json:"meta"`
	Container  ContainerConfig  `json:"container"`
	Pagination PaginationConfig `json:"pagination"`
	Fields     []FieldConfig    `json:"fields"`
	Output     OutputConfig     `json:"output"`
}

type MetaConfig struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type ContainerConfig struct {
	Selector string `json:"selector"`
	Type     string `json:"type"`
}

type PaginationConfig struct {
	Type     string `json:"type"` // next_button, page_loop, none
	Selector string `json:"selector"`
	Limit    int    `json:"limit"`
}

type FieldConfig struct {
	Name     string `json:"name"`
	Selector string `json:"selector"`
	Attr     string `json:"attr"`    // text, href, src
	Filter   string `json:"filter"`  // none, number, url, custom
	Formula  string `json:"formula"` // <--- NEW: Stores the pipe chain (e.g. "trim | upper")
}

type OutputConfig struct {
	Filename string `json:"filename"`
	Format   string `json:"format"` // csv, json
}

// --- BACKEND MANAGER ---

type Backend struct {
	RootDir string
}

var backend *Backend // Global instance

func InitBackend() {
	backend = &Backend{RootDir: "Scraper_Projects"}
	os.MkdirAll(backend.RootDir, os.ModePerm) // ponytail: MkdirAll is no-op if exists
}

func (b *Backend) GetProjects() []string {
	files, _ := os.ReadDir(b.RootDir)
	var projects []string
	for _, f := range files {
		if f.IsDir() {
			projects = append(projects, f.Name())
		}
	}
	return projects
}

func (b *Backend) CreateProject(name string) {
	path := filepath.Join(b.RootDir, name)
	os.Mkdir(path, os.ModePerm)
	os.Mkdir(filepath.Join(path, "outputs"), os.ModePerm)
}

func (b *Backend) DeleteProject(name string) {
	os.RemoveAll(filepath.Join(b.RootDir, name))
}

func (b *Backend) GetConfigs(projectName string) []string {
	path := filepath.Join(b.RootDir, projectName)
	files, _ := os.ReadDir(path)
	var configs []string
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".json") {
			configs = append(configs, f.Name())
		}
	}
	return configs
}

func (b *Backend) DeleteConfig(projectName, filename string) {
	path := filepath.Join(b.RootDir, projectName, filename)
	os.Remove(path)
}

// SaveConfig handles saving and RENAMING if the name changed.
func (b *Backend) SaveConfig(projectName string, config ScraperConfig, oldFilename string) (string, error) {
	data, _ := json.MarshalIndent(config, "", "  ")

	// 1. Generate the NEW filename based on the input name
	newFilename := strings.ReplaceAll(config.Meta.Name, " ", "_")
	if newFilename == "" {
		newFilename = "Untitled"
	}
	if !strings.HasSuffix(newFilename, ".json") {
		newFilename += ".json"
	}

	// 2. Write the NEW file
	err := os.WriteFile(filepath.Join(b.RootDir, projectName, newFilename), data, 0644)
	if err != nil {
		return "", err
	}

	// 3. If this was an edit (oldFilename exists) AND the name is different, DELETE the old file.
	if oldFilename != "" && oldFilename != newFilename {
		oldPath := filepath.Join(b.RootDir, projectName, oldFilename)
		os.Remove(oldPath) // This completes the "Rename" process
	}

	return newFilename, nil
}

func (b *Backend) LoadConfig(projectName, filename string) (ScraperConfig, error) {
	path := filepath.Join(b.RootDir, projectName, filename)
	file, err := os.ReadFile(path)
	var config ScraperConfig
	if err != nil {
		return config, err
	}
	err = json.Unmarshal(file, &config)
	return config, err
}

func (b *Backend) ImportConfig(projectName string, file multipart.File, header *multipart.FileHeader) error {
	dstPath := filepath.Join(b.RootDir, projectName, header.Filename)
	dst, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, file)
	return err
}