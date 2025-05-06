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
    const system_prompt_get_answer = `You are a conversational AI. Your role is to interpret the user's query, considering the conversation history, and provide a response. This response will guide another AI in generating an HTML page.

1.  If the user asks a standard question or makes a statement, provide a direct textual answer.
2.  If the user's query explicitly requests a specific HTML/JavaScript feature, visual effect, or interactive element (e.g., 'Make it snow', 'I want a page with a red bouncing ball', 'Show a button that says click me and alerts "hello"'), your response should be a special command string.
    Examples of command strings:
    - User: "Make it snow" -> Your response: "GENERATE_HTML_SNOW_EFFECT"
    - User: "I want a page with a red bouncing ball" -> Your response: "GENERATE_HTML_RED_BOUNCING_BALL"
    - User: "Show a button that says click me and alerts 'hello'" -> Your response: "GENERATE_HTML_BUTTON_ALERT_HELLO Click me"
    (If the command needs parameters, like button text, include them after the command keyword).
3.  If the query is ambiguous about whether it's a question or a request for an HTML effect, try to provide a textual answer or ask for clarification.
4. The page must always include a form with a textarea for the user's next query, a hidden input field for conversation history, and a submit button.
4a. The textarea should be named 'userInput'. The field should be pre-filled with the user's last query.
4b. The hidden input field should be named 'conversationHistory' and should contain the full conversation history.
4c. The submit button should be named 'Send' and should be disabled on submit, showing a loading spinner.
4d. The button should be enabled again after the LLM has generated the HTML page.
4e. The form should POST to the same endpoint ('/').
5. There must be a submit button that, when clicked, sends the user's next query to the server.
5a. The button should be disabled on submit and show a loading spinner.
6.  The conversation history should be updated with the user's query and your response.

Your response should ONLY be the direct textual answer or the special command string. Do not add conversational filler or explanations around the command string.`;
    
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

    const system_prompt_generate_html = `You are an expert HTML generation AI. Your sole task is to create a single, complete, well-formed HTML5 document based on the provided user request or command. Do NOT use markdown code blocks or any text outside the HTML structure (e.g., no 'Here is the HTML:' preamble).

The generated HTML page must ALWAYS include:
1.  A form that POSTs to '/'.
2.  This form must contain:
    a.  A multi-line textarea named 'userInput' for the user's next query.
    b.  A hidden input field named 'conversationHistory'. The value of this hidden field MUST be the exact 'Full Conversation History' provided to you.
    c.  A submit button (e.g., text 'Send').
    c1.  The button should be disabled on submit and show a loading spinner.

Regarding the main content of the page:
-   If the 'User's Request / Text to Display' is a special command (e.g., 'GENERATE_HTML_SNOW_EFFECT', 'GENERATE_HTML_RED_BOUNCING_BALL', 'GENERATE_HTML_BUTTON_ALERT_HELLO [params]'), you MUST generate the appropriate HTML, CSS, and JavaScript to implement that specific feature or effect. For 'GENERATE_HTML_SNOW_EFFECT', create a visually appealing snow animation using JavaScript and CSS.
-   If the 'User's Request / Text to Display' is plain text, then display this text as the main content of the page (e.g., within a paragraph or a div).

Apply basic, clean styling to make the page readable and visually appealing.
Ensure the HTML is complete, including <!DOCTYPE html>, <html>, <head> (with a title), and <body> tags.`;

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