package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
)

// Request structure for Claude API
type ClaudeRequest struct {
	Model    string    `json:"model"`
	MaxTokens int      `json:"max_tokens"`
	Messages  []Message `json:"messages"`
}

// Message structure for Claude API
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func main() {
	// Check if API key is available
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		// Try to load from .env file
		content, err := os.ReadFile(".env")
		if err == nil {
			lines := strings.Split(string(content), "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "ANTHROPIC_API_KEY=") {
					apiKey = strings.TrimPrefix(line, "ANTHROPIC_API_KEY=")
					break
				}
			}
		}
		
		if apiKey == "" {
			log.Fatal("ANTHROPIC_API_KEY not found in environment or .env file")
		}
	}
	
	fmt.Println("Starting LLM HTTP Server on port 3431...")
	
	// Handle all requests
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Create the request to Claude API
		claudeReq := ClaudeRequest{
			//Model:     "claude-3-haiku-20240307", // "claude-3-7-sonnet-20250219",
			Model:     "claude-3-7-sonnet-20250219",
			MaxTokens: 4096,
			Messages: []Message{
				{
					Role:    "user",
					Content: fmt.Sprintf("You are simulating a web server. Generate an HTML response for: Method: %s, Path: %s, Query: %s. Return only valid HTML with no explanations. Start your response with exactly <!DOCTYPE html>. Make a web application that is fully usable. Make sure the links point to the correct path. Do not include any other text or explanations. Make it colorful. The request is: %s %s?%s", 
						r.Method, r.URL.Path, r.URL.RawQuery),
				},
			},
		}
		
		// Convert to JSON
		jsonData, err := json.Marshal(claudeReq)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		
		// Create request to Claude API
		req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewBuffer(jsonData))
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		
		// Set headers
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
		req.Header.Set("content-type", "application/json")
		
		// Make the request
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "Failed to call Claude API: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer resp.Body.Close()
		
		// Read the response
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, "Failed to read response", http.StatusInternalServerError)
			return
		}
		
		// Extract HTML content from JSON
		htmlContent := extractHTML(string(body))
		
		// Set content type to HTML
		w.Header().Set("Content-Type", "text/html")
		
		// Return the HTML content
		fmt.Fprint(w, htmlContent)
	})
	
	// Start server
	log.Fatal(http.ListenAndServe(":3431", nil))
}

// Extract HTML content from Claude API JSON response
func extractHTML(jsonResponse string) string {
	// Regular expression to extract content between <!DOCTYPE html> and </html>
	re := regexp.MustCompile(`(?s).*?(<!DOCTYPE html>.*?</html>)`)
	matches := re.FindStringSubmatch(jsonResponse)
	
	if len(matches) < 2 {
		// If no match found, return error message as HTML
		return "<html><body><h1>Error</h1><p>Failed to extract HTML content from API response.</p><pre>" + 
			jsonResponse + "</pre></body></html>"
	}
	
	// Get the HTML content
	htmlContent := matches[1]
	
	// Replace escaped characters with their actual values
	htmlContent = strings.ReplaceAll(htmlContent, "\\n", "\n")
	htmlContent = strings.ReplaceAll(htmlContent, "\\t", "\t")
	htmlContent = strings.ReplaceAll(htmlContent, "\\\"", "\"")
	
	return htmlContent
}