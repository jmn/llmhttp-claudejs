const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Added to parse form data

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Simple middleware for logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Root GET endpoint
app.get('/', async (req, res) => {
  const htmlPrompt = "Generate a complete HTML5 page. The page should have a title \\\'LLM Interaction\\\'. In the body, include a heading H1 with text \\\'Interact with LLM\\\'. Below the heading, create a form with method=\\\'POST\\\' action=\\\'/ask\\\'. This form must contain: 1. A text input field named \\\'userInput\\\'. 2. A hidden input field named \\\'conversationHistory\\\' with an empty value (value=\\\"\\\"). 3. A submit button (e.g., text=\\\'Send\\\'). Only output the raw HTML code. Do not use markdown code blocks.";

  try {
    // Call the Claude API to generate HTML
    const llmResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-7-sonnet-20250219', // Or your preferred model
        max_tokens: 1024,
        system: "You are an AI assistant that generates HTML code based on user requests. Only output the HTML code itself RAW. Do not wrap the HTML in any other text. DO NOT use code blocks. ONLY RESPOND WITH HTML",
        messages: [{ role: 'user', content: htmlPrompt }]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );

    let generatedHtml = llmResponse.data.content[0].text;
    generatedHtml = generatedHtml.replace("```html", "").replace("```", "").trim(); // Clean up the response
    res.setHeader('Content-Type', 'text/html');
    res.send(generatedHtml);

  } catch (error) {
    console.error('Error generating HTML page via LLM:', error.response?.data || error.message);
    res.status(500).send('Error generating HTML page. Check server logs.');
  }
});

// Main LLM endpoint
app.post('/ask', async (req, res) => {
  const currentUserQuery = req.body.userInput;
  const incomingConversationHistory = req.body.conversationHistory || ""; // Ensure it's a string
  const clientPreprompt = req.body.preprompt || "";
  // Max tokens for the first call (getting answer) can be smaller.
  const maxTokensForAnswer = parseInt(req.body.maxTokensForAnswer) || 500; 
  // Max tokens for HTML generation might need to be larger.
  const maxTokensForHtml = parseInt(req.body.maxTokensForHtml) || 2048;

  if (!currentUserQuery) {
    // For API-like errors or initial errors, JSON might still be okay or an HTML error page
    return res.status(400).send("<html><body><h1>Error</h1><p>Prompt (or userInput) is required</p><a href=\"/\">Try again</a></body></html>");
  }

  try {
    // --- Step 1: Get contextual answer from LLM ---
    const system_prompt_get_answer = "You are a conversational AI. Given the conversation history and a new user query, provide a concise and relevant textual answer to the new query. Focus only on providing the direct answer text, not any other conversational filler, HTML, or markdown.";
    
    let user_message_get_answer = "";
    if (incomingConversationHistory) {
      user_message_get_answer += `Conversation History:\n${incomingConversationHistory}\n\n`;
    }
    user_message_get_answer += `New User Query:\n${currentUserQuery}\n\nYour Answer:`;

    if (clientPreprompt) {
      user_message_get_answer = `${clientPreprompt}\n\n${user_message_get_answer}`;
    }

    const answerResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: maxTokensForAnswer,
        system: system_prompt_get_answer,
        messages: [{ role: 'user', content: user_message_get_answer }]
      },
      { headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
    );

    const currentLlmAnswerText = answerResponse.data.content[0].text.trim();

    // --- Step 2: Update conversation history (server-side) ---
    const updatedConversationHistory = `${incomingConversationHistory}User: ${currentUserQuery}\nAssistant: ${currentLlmAnswerText}\n---\n`;

    // --- Step 3: Get LLM to generate HTML page with updated history and answer ---

    const system_prompt_generate_html = "You are an expert HTML generation AI. Your sole task is to create a single, complete, well-formed HTML5 document. Do NOT use markdown code blocks or any text outside the HTML structure (e.g. no 'Here is the HTML:' preamble). The HTML page must display the latest AI answer and include a form for the user to continue the conversation. This form must POST to '/ask' and contain a textarea named 'userInput' for the next query, and a hidden input field named 'conversationHistory' which must contain the full, updated conversation history provided.";

    const user_message_generate_html = `
Please generate a complete HTML5 page incorporating the following data:

1.  **Latest AI Answer to display to the user:**
    ${currentLlmAnswerText}

2.  **Full Conversation History (to be placed in a hidden input field named 'conversationHistory'):**
    ${updatedConversationHistory}

**Requirements for the HTML page:**
-   It must be a single, complete HTML5 document.
-   Include a suitable title (e.g., 'LLM Conversation').
-   Display the 'Latest AI Answer' clearly to the user.
-   Provide a form that POSTs to the '/ask' endpoint.
-   This form must contain:
    a.  A multi-line textarea named 'userInput' for the user's next query.
    b.  A hidden input field named 'conversationHistory'. The value of this hidden field MUST be the exact 'Full Conversation History' provided above.
    c.  A submit button (e.g., text 'Send').
- Apply some basic, clean styling to make the page readable (e.g., for body, headings, answer display, form elements).
`;

    const htmlResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-7-sonnet-20250219', // Or a model known for good HTML/code generation if available
        max_tokens: maxTokensForHtml,
        system: system_prompt_generate_html,
        messages: [{ role: 'user', content: user_message_generate_html }]
      },
      { headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
    );

    let generatedHtml = htmlResponse.data.content[0].text;
    // Clean up common LLM artifacts like ```html ... ``` if they appear
    generatedHtml = generatedHtml.replace(/^```html\s*/i, '').replace(/\s*```$/, '').trim();
    
    res.setHeader('Content-Type', 'text/html');
    return res.send(generatedHtml);

  } catch (error) {
    console.error('Error in /ask endpoint:', error.response?.data || error.message);
    const errorDetails = error.response?.data?.error?.message || error.message || 'An unknown error occurred.';
    const errorHtmlResponse = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
          body { font-family: sans-serif; margin: 20px; color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; }
          a { display: inline-block; margin-top: 20px; padding: 10px 15px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; }
          a:hover { background-color: #0056b3; }
        </style>
      </head>
      <body>
        <h1>Error Processing Request</h1>
        <p>Sorry, an error occurred while trying to get a response from the LLM.</p>
        <p><strong>Details:</strong> ${errorDetails}</p>
        <a href="/">Try again</a>
      </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(errorHtmlResponse);
  }
});

// Custom endpoint for specific functionality
app.post('/summarize', async (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const prompt = `Please summarize the following text concisely: \n\n${text}`;
  
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 500,
        system: "You are a helpful assistant that creates concise summaries.",
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );

    return res.json({
      summary: response.data.content[0].text
    });
  } catch (error) {
    console.error('Error calling Claude API:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to summarize text' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LLM Web Server running on port ${PORT}`);
});