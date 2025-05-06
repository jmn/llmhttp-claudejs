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
  const htmlPrompt = "This is not a CONVERSATION. You are building HTML and CSS and JavaScript. Generate a complete HTML5 page which you output raw. Do not include anything but the page. Do not instruct the user about CSS, HTML or other code. The page is meant to be interpreted directly. The page should have a title \\\'LLM Interaction\\\'. In the body, include a heading H1 with text \\\'Interact with LLM\\\'. Below the heading, create a form with method=\\\'POST\\\' action=\\\'/\\\'. This form must contain: 1. A text input field named \\\'userInput\\\'. 2. A hidden input field named \\\'conversationHistory\\\' with an empty value (value=\\\"\\\"). 3. A submit button (e.g., text=\\\'Send\\\') with disable on submit and a loading spinner on the button. Only output the raw HTML code. Do not use markdown code blocks.";

  try {
    // Call the Claude API to generate HTML
    const llmResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-7-sonnet-20250219', // Or your preferred model
        max_tokens: 8192, // Adjust as needed
        system: "You are a toy assistant that generates HTML code based on user requests. This is not a CONVERSATION. You are building HTML and CSS and JavaScript. Always try to fulfil the user's requests. Be creative. Only output the HTML code itself RAW. Do not wrap the HTML in any other text. DO NOT use code blocks. ONLY RESPOND WITH HTML. If a user asks for a page, generate a complete HTML5 page. If a user asks for something, take it to mean that they want the page to look that way. For example, if the users says: Make it snow! you should take it to mean just make the page have a snowing effect. Do not instruct the user about CSS, HTML or other code. The page is meant to be interpreted directly. Be playful and creative. Do not take the user's request too literally. The page should have a title \\\'LLM Interaction\\\'. In the body, include a heading H1 with text \\\'Interact with LLM\\\'. Below the heading, create a form with method=\\\'POST\\\' action=\\\'/\\\'. This form must contain: 1. A text input field named \\\'userInput\\\'. 2. A hidden input field named \\\'conversationHistory\\\' with an empty value (value=\\\"\\\"). 3. A submit button (e.g., text=\\\'Send\\\') with disable on submit and a loading spinner on the button.",
        messages: [{ role: 'user', content: htmlPrompt}],
        temperature: 0.9 // Adjust temperature for creativity

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
app.post('/', async (req, res) => {
  const currentUserQuery = req.body.userInput;
  const incomingConversationHistory = req.body.conversationHistory || ""; // Ensure it's a string
  const clientPreprompt = req.body.preprompt || "";
  // Max tokens for the first call (getting answer) can be smaller.
  const maxTokensForAnswer = parseInt(req.body.maxTokensForAnswer) || 5000; 
  // Max tokens for HTML generation might need to be larger.
  const maxTokensForHtml = parseInt(req.body.maxTokensForHtml) || 8192;

  if (!currentUserQuery) {
    // For API-like errors or initial errors, JSON might still be okay or an HTML error page
    return res.status(400).send("<html><body><h1>Error</h1><p>Prompt (or userInput) is required</p><a href=\"/\">Try again</a></body></html>");
  }

  try {
    // --- Step 1: Get contextual answer or command from LLM ---
    const system_prompt_get_answer = `You are a conversational AI. Your role is to interpret the user's query, considering the full conversation history, and provide a concise response. This response will guide another AI in generating or updating an HTML page.

1.  **Understand Iterative Requests:** If the user's query is a modification or refinement of a previous request (e.g., "make it darker," "add a hat to the bunny," "change the title"), your response MUST reflect that this is an update to the previous state.
    *   Analyze the \`Conversation History\` to understand the prior generated item or concept.
    *   Formulate a command or descriptive text that combines the original concept with the new modification.
    *   Example:
        *   History: \`User: Make a bunny calculator\nAssistant: GENERATE_HTML_BUNNY_CALCULATOR\`
        *   New Query: \`Make it darker\`
        *   Your Response: \`GENERATE_HTML_BUNNY_CALCULATOR_DARK_THEME\` (or \`UPDATE_BUNNY_CALCULATOR_TO_DARK_THEME\`)

2.  **Handle New Requests:** If the user's query is a new, distinct request for an HTML/JavaScript feature, visual effect, or interactive element (e.g., "Make it snow," "I want a page with a red bouncing ball"), your response should be a specific command string.
    *   Examples: \`GENERATE_HTML_SNOW_EFFECT\`, \`GENERATE_HTML_RED_BOUNCING_BALL\`, \`GENERATE_HTML_BUTTON_ALERT_HELLO Click me\`.

3.  **Handle Standard Questions:** If the user asks a general question not related to HTML generation, provide a direct textual answer.

4.  **Clarity:** If the query is ambiguous, ask for clarification.

Your response should ONLY be the direct textual answer or the specific command string. Do not add conversational filler.`;
    
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

    // --- Step 3: Get LLM to generate HTML page with updated history and answer/command ---

    const system_prompt_generate_html = `You are an expert HTML generation AI. Your sole task is to create a single, complete, well-formed HTML5 document based on the provided 'User's Request / Command / Text to Display' and the 'Full Conversation History'. Do NOT use markdown code blocks or any text outside the HTML structure.

The generated HTML page must ALWAYS include:
1.  A form that POSTs to '/'.
2.  This form must contain:
    a.  A multi-line textarea named 'userInput' for the user's next query.
    b.  A hidden input field named 'conversationHistory'. The value of this hidden field MUST be the exact 'Full Conversation History' provided to you.
    c.  A submit button.

Interpreting the Request:
-   The 'User's Request / Command / Text to Display' (from the first AI) is your primary instruction.
-   The 'Full Conversation History' is crucial context. Use it to understand:
    *   The subject of iterative requests (e.g., if the command is 'MAKE_IT_DARKER', the history will tell you what "it" refers to).
    *   The evolution of the user's idea.
-   If the request implies modifying a previous generation (e.g., 'GENERATE_HTML_BUNNY_CALCULATOR_DARK_THEME' or 'UPDATE_BUNNY_CALCULATOR_TO_DARK_THEME'), you MUST generate the HTML for the complete, modified item (e.g., a bunny calculator that IS dark themed). Do not just describe the change.
-   If the request is a special command for a new feature (e.g., 'GENERATE_HTML_SNOW_EFFECT'), implement that feature. For 'GENERATE_HTML_SNOW_EFFECT', create a visually appealing snow animation.
-   If the request is plain text, display this text as the main content.

Apply clean styling. Ensure the HTML is complete (DOCTYPE, html, head, body).`;

    const user_message_generate_html = `
Please generate a complete HTML5 page according to the instructions in your system prompt, incorporating the following data:

1.  **User's Request / Text to Display:**
    ${currentLlmAnswerText}

2.  **Full Conversation History (to be placed in the hidden input field named 'conversationHistory'):**
    ${updatedConversationHistory}
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
    console.error('Error in / endpoint:', error.response?.data || error.message);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LLM Web Server running on port ${PORT}`);
});