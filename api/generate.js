// This function handles POST requests for the Vercel API endpoint.
// It verifies the Firebase ID Token sent by the mobile app before calling the Gemini API.

const admin = require('firebase-admin');

// --- CRITICAL CONFIGURATION ---
// These are required for the Firebase Admin SDK to verify the token.
// They MUST be set as environment variables in the Vercel Dashboard!
const SERVICE_ACCOUNT_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
    if (!SERVICE_ACCOUNT_KEY) {
        console.error("FIREBASE_SERVICE_ACCOUNT_KEY is missing. Admin SDK cannot be initialized.");
    } else {
        try {
            // The service account key is expected to be a stringified JSON object
            const serviceAccount = JSON.parse(SERVICE_ACCOUNT_KEY);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } catch (e) {
            console.error("Error parsing FIREBASE_SERVICE_ACCOUNT_KEY:", e);
        }
    }
}

const API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';

module.exports = async (request, response) => {
    // 1. Basic checks
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!GEMINI_API_KEY) {
        return response.status(500).json({ error: 'Server key not configured.' });
    }
    if (!SERVICE_ACCOUNT_KEY || !admin.apps.length) {
         return response.status(500).json({ error: 'Firebase Admin not configured on server.' });
    }

    // 2. Token Verification (The Secure Gate)
    let decodedToken;
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return response.status(401).json({ error: 'Authorization header missing or invalid.' });
        }
        const idToken = authHeader.split('Bearer ')[1];
        
        // This is the core security check: Firebase verifies the token's signature, expiry, and issuer.
        decodedToken = await admin.auth().verifyIdToken(idToken);

        // Optional: Check if the user is disabled or banned (if you implemented that)
        if (!decodedToken || decodedToken.uid === null) {
            return response.status(403).json({ error: 'Invalid or revoked user token.' });
        }
        
    } catch (error) {
        console.error("Token verification error:", error.code, error.message);
        // Return 403 Forbidden instead of 401 Unauthorized for production apps 
        // to prevent token brute-forcing when tokens are known to be present.
        return response.status(403).json({ error: 'Access denied: Token verification failed.' });
    }

    // --- If we reach here, the user is authenticated and trusted. ---

    // 3. Process Payload
    const payload = request.body || {};
    const { parts, systemInstruction } = payload;
    
    if (!parts || !Array.isArray(parts)) {
         return response.status(400).json({ error: 'Missing content parts.' });
    }
    
    // 4. Construct and Call the Gemini API
    const geminiPayload = {
        contents: [{ role: "user", parts: parts }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
    };

    const apiUrl = `${API_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    try {
        // ... (Retry logic for robustness)
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
