//node check_models.js

// check_models.js (Fixed)
const https = require('https');
const fs = require('fs');
const path = require('path');

// Read API KEY from .env manually
const envPath = path.resolve(__dirname, '.env');
let envContent = '';
try {
    envContent = fs.readFileSync(envPath, 'utf-8');
} catch (e) {
    console.error('Error reading .env file:', e.message);
    process.exit(1);
}

const apiKeyMatch = envContent.match(/AI_API_KEY=(.*)/);
const API_KEY = apiKeyMatch ? apiKeyMatch[1].trim() : null;

if (!API_KEY) {
    console.error('Error: Could not find AI_API_KEY in .env');
    process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

console.log('Contacting Google API...');

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        let json;
        try {
            json = JSON.parse(data);
        } catch (e) {
            console.error('Failed to parse JSON response.');
            return;
        }

        if (json.error) {
            console.error('API Error:', json.error);
            return;
        }
        
        console.log('
=== AVAILABLE MODELS ===');
        const models = json.models || [];
        
        // Filter only generative models
        const genModels = models.filter(m => 
            m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
        );

        genModels.forEach(m => {
            const name = m.name.replace('models/', '');
            // Safe retrieval of description
            const desc = m.description ? m.description.substring(0, 60) + '...' : '(No description)';
            
            console.log(`\nName: ${name}`);
            console.log(`Desc: ${desc}`);
        });
        console.log('\n========================');
    });
}).on('error', (e) => {
    console.error('Network Error:', e);
});