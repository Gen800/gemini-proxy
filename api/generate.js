// This function handles POST requests for the Vercel/Netlify API endpoint.
// It uses the secure GEMINI_API_KEY environment variable.

const API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';

// The 'request' object contains the incoming HTTP request.
// This structure is compatible with Vercel/Netlify functions.
module.exports = async (request, response) => {
    // 1. Check method and retrieve API Key
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }
    
    // CRITICAL: Get the API key from the environment variables (hidden from public)
    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) {
        console.error("GEMINI_API_KEY environment variable is not set.");
        return response.status(500).json({ error: 'Server key not configured.' });
    }

    // 2. Parse the request body (assuming Vercel/Netlify handles JSON parsing if header is set)
    const payload = request.body || {};

    const { parts, systemInstruction } = payload;
    
    if (!parts || !Array.isArray(parts)) {
         return response.status(400).json({ error: 'Missing content parts.' });
    }
    
    // 3. Construct the Gemini API payload
    const geminiPayload = {
        contents: [{ role: "user", parts: parts }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
    };

    const apiUrl = `${API_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    // 4. Call the Gemini API
    try {
        // Retry logic for robustness
        let geminiResponse;
        const maxRetries = 3;
        const delay = 1000;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            geminiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(geminiPayload)
            });

            if (geminiResponse.ok || attempt === maxRetries - 1) break;

            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
        }

        const result = await geminiResponse.json();

        if (!geminiResponse.ok) {
            console.error("External API Error:", result);
            return response.status(geminiResponse.status).json({ 
                error: 'AI Service Error', 
                details: result 
            });
        }

        // 5. Extract and return the generated text
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
             return response.status(500).json({ error: 'AI response was empty.' });
        }

        return response.status(200).json({ text: text });

    } catch (e) {
        console.error("Proxy fetch error:", e);
        return response.status(500).json({ error: 'Internal server error during fetch.' });
    }
};
