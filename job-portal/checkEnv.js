const path = require('path');
const fs = require('fs');

console.log('--- Running Environment Variable Diagnostic ---');

const envPath = path.join(__dirname, '.env');

try {
    const envFileContent = fs.readFileSync(envPath, 'utf-8');
    const result = require('dotenv').parse(envFileContent);

    console.log('\nVariables parsed successfully from .env file:');
    console.log(result);
} catch (e) {
    console.error(`\nFATAL ERROR: Could not read or parse the .env file at ${envPath}`);
    console.error(`Error details: ${e.message}`);
}